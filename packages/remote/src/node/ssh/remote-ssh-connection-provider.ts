// *****************************************************************************
// Copyright (C) 2023 TypeFox and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from '@theia/core/shared/fs-extra';
import { Emitter, Event, MessageService, QuickInputService } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { RemoteSSHConnectionProvider } from '../../common/remote-ssh-connection-provider';
import { RemoteExpressProxyContribution } from '../remote-express-proxy-contribution';
import { RemoteConnectionService } from '../remote-connection-service';
import { RemoteProxyServerProvider } from '../remote-proxy-server-provider';
import { RemoteConnection, RemoteCopyOptions, RemoteExecOptions, RemoteExecResult, RemoteExecTester, RemoteStatusReport } from '../remote-types';
import * as ssh2 from 'ssh2';
import SftpClient = require('ssh2-sftp-client');
import * as net from 'net';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { SSHIdentityFileCollector, SSHKey } from './ssh-identity-file-collector';
import { RemoteSetupService } from '../remote-setup-service';

@injectable()
export class RemoteSSHConnectionProviderImpl implements RemoteSSHConnectionProvider {

    @inject(RemoteConnectionService)
    protected readonly remoteConnectionService: RemoteConnectionService;

    @inject(RemoteProxyServerProvider)
    protected readonly serverProvider: RemoteProxyServerProvider;

    @inject(SSHIdentityFileCollector)
    protected readonly identityFileCollector: SSHIdentityFileCollector;

    @inject(RemoteExpressProxyContribution)
    protected readonly remoteExpressProxy: RemoteExpressProxyContribution;

    @inject(RemoteSetupService)
    protected readonly remoteSetup: RemoteSetupService;

    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    protected passwordRetryCount = 3;
    protected passphraseRetryCount = 3;

    async establishConnection(host: string, user: string): Promise<string> {
        const progress = await this.messageService.showProgress({
            text: 'Remote SSH'
        });
        const report: RemoteStatusReport = message => progress.report({ message });
        report('Connecting to remote system...');
        try {
            const remote = await this.establishSSHConnection(host, user);
            await this.remoteSetup.setup(remote, report);
            const registration = this.remoteConnectionService.register(remote);
            const server = await this.serverProvider.getProxyServer(socket => {
                remote.forwardOut(socket);
            });
            const proxyRouter = this.remoteExpressProxy.setupProxyRouter(remote, server);
            remote.onDidDisconnect(() => {
                server.close();
                proxyRouter.dispose();
                registration.dispose();
            });
            return remote.id;
        } finally {
            progress.cancel();
        }
    }

    async establishSSHConnection(host: string, user: string): Promise<RemoteSSHConnection> {
        const deferred = new Deferred<RemoteSSHConnection>();
        const sessionId = this.remoteConnectionService.getConnectionId();
        const sshClient = new ssh2.Client();
        const identityFiles = await this.identityFileCollector.gatherIdentityFiles();
        const sshAuthHandler = this.getAuthHandler(user, host, identityFiles);
        sshClient
            .on('ready', async () => {
                const connection = new RemoteSSHConnection({
                    client: sshClient,
                    id: sessionId,
                    name: host,
                    type: 'SSH'
                });
                deferred.resolve(connection);
            }).on('error', err => {
                deferred.reject(err);
            }).connect({
                host: host,
                username: user,
                authHandler: (methodsLeft, successes, callback) => (sshAuthHandler(methodsLeft, successes, callback), undefined)
            });
        return deferred.promise;
    }

    protected getAuthHandler(user: string, host: string, identityKeys: SSHKey[]): ssh2.AuthHandlerMiddleware {
        let passwordRetryCount = this.passwordRetryCount;
        let keyboardRetryCount = this.passphraseRetryCount;
        // `false` is a valid return value, indicating that the authentication has failed
        const END_AUTH = false as unknown as ssh2.AuthenticationType;
        // `null` indicates that we just want to continue with the next auth type
        // eslint-disable-next-line no-null/no-null
        const NEXT_AUTH = null as unknown as ssh2.AuthenticationType;
        return async (methodsLeft: string[] | null, _partialSuccess: boolean | null, callback: ssh2.NextAuthHandler) => {
            if (!methodsLeft) {
                return callback({
                    type: 'none',
                    username: user,
                });
            }
            if (methodsLeft && methodsLeft.includes('publickey') && identityKeys.length) {
                const identityKey = identityKeys.shift()!;
                if (identityKey.isPrivate) {
                    return callback({
                        type: 'publickey',
                        username: user,
                        key: identityKey.parsedKey
                    });
                }
                if (!await fs.pathExists(identityKey.filename)) {
                    // Try next identity file
                    return callback(NEXT_AUTH);
                }

                const keyBuffer = await fs.promises.readFile(identityKey.filename);
                let result = ssh2.utils.parseKey(keyBuffer); // First try without passphrase
                if (result instanceof Error && result.message === 'Encrypted private OpenSSH key detected, but no passphrase given') {
                    let passphraseRetryCount = this.passphraseRetryCount;
                    while (result instanceof Error && passphraseRetryCount > 0) {
                        const passphrase = await this.quickInputService.input({
                            title: `Enter passphrase for ${identityKey.filename}`,
                            password: true
                        });
                        if (!passphrase) {
                            break;
                        }
                        result = ssh2.utils.parseKey(keyBuffer, passphrase);
                        passphraseRetryCount--;
                    }
                }
                if (!result || result instanceof Error) {
                    // Try next identity file
                    return callback(NEXT_AUTH);
                }

                const key = Array.isArray(result) ? result[0] : result;
                return callback({
                    type: 'publickey',
                    username: user,
                    key
                });
            }
            if (methodsLeft && methodsLeft.includes('password') && passwordRetryCount > 0) {
                const password = await this.quickInputService.input({
                    title: `Enter password for ${user}@${host}`,
                    password: true
                });
                passwordRetryCount--;

                return callback(password
                    ? {
                        type: 'password',
                        username: user,
                        password
                    }
                    : END_AUTH);
            }
            if (methodsLeft && methodsLeft.includes('keyboard-interactive') && keyboardRetryCount > 0) {
                return callback({
                    type: 'keyboard-interactive',
                    username: user,
                    prompt: async (_name, _instructions, _instructionsLang, prompts, finish) => {
                        const responses: string[] = [];
                        for (const prompt of prompts) {
                            const response = await this.quickInputService.input({
                                title: `(${user}@${host}) ${prompt.prompt}`,
                                password: !prompt.echo
                            });
                            if (response === undefined) {
                                keyboardRetryCount = 0;
                                break;
                            }
                            responses.push(response);
                        }
                        keyboardRetryCount--;
                        finish(responses);
                    }
                });
            }

            callback(END_AUTH);
        };
    }

    isConnectionAlive(remoteId: string): Promise<boolean> {
        return Promise.resolve(Boolean(this.remoteConnectionService.getConnection(remoteId)));
    }

}

export interface RemoteSSHConnectionOptions {
    id: string;
    name: string;
    type: string;
    client: ssh2.Client;
}

export class RemoteSSHConnection implements RemoteConnection {

    id: string;
    name: string;
    type: string;
    client: ssh2.Client;
    remotePort = 0;

    private sftpClientPromise: Promise<SftpClient>;

    private readonly onDidDisconnectEmitter = new Emitter<void>();

    get onDidDisconnect(): Event<void> {
        return this.onDidDisconnectEmitter.event;
    }

    constructor(options: RemoteSSHConnectionOptions) {
        this.id = options.id;
        this.type = options.type;
        this.name = options.name;
        this.client = options.client;
        this.onDidDisconnect(() => this.dispose());
        this.client.on('end', () => {
            this.onDidDisconnectEmitter.fire();
        });
        this.sftpClientPromise = this.setupSftpClient();
    }

    protected async setupSftpClient(): Promise<SftpClient> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sftpClient = new SftpClient() as any;
        // A hack to set the internal ssh2 client of the sftp client
        // That way, we don't have to create a second connection
        sftpClient.client = this.client;
        // Calling this function establishes the sftp connection on the ssh client
        await sftpClient.getSftpChannel();
        return sftpClient;
    }

    forwardOut(socket: net.Socket): void {
        this.client.forwardOut(socket.localAddress!, socket.localPort!, '127.0.0.1', this.remotePort, (err, stream) => {
            if (err) {
                console.debug('Proxy message rejected', err);
            } else {
                stream.pipe(socket).pipe(stream);
            }
        });
    }

    async copy(localPath: string, remotePath: string, options?: RemoteCopyOptions): Promise<void> {
        const sftpClient = await this.sftpClientPromise;
        await sftpClient.fastPut(localPath, remotePath, {
            mode: options?.mode
        });
    }

    exec(cmd: string, args?: string[], options: RemoteExecOptions = {}): Promise<RemoteExecResult> {
        const deferred = new Deferred<RemoteExecResult>();
        cmd = this.buildCmd(cmd, args);
        this.client.exec(cmd, options, (err, stream) => {
            if (err) {
                return deferred.reject(err);
            }
            let stdout = '';
            let stderr = '';
            stream.on('close', () => {
                deferred.resolve({ stdout, stderr });
            }).on('data', (data: Buffer | string) => {
                stdout += data.toString();
            }).stderr.on('data', (data: Buffer | string) => {
                stderr += data.toString();
            });
        });
        return deferred.promise;
    }

    execPartial(cmd: string, tester: RemoteExecTester, args?: string[], options: RemoteExecOptions = {}): Promise<RemoteExecResult> {
        const deferred = new Deferred<RemoteExecResult>();
        cmd = this.buildCmd(cmd, args);
        this.client.exec(cmd, options, (err, stream) => {
            if (err) {
                return deferred.reject(err);
            }
            let stdout = '';
            let stderr = '';
            stream.on('close', () => {
                if (deferred.state === 'unresolved') {
                    deferred.resolve({ stdout, stderr });
                }
            }).on('data', (data: Buffer | string) => {
                if (deferred.state === 'unresolved') {
                    stdout += data.toString();

                    if (tester(stdout, stderr)) {
                        deferred.resolve({ stdout, stderr });
                    }
                }
            }).stderr.on('data', (data: Buffer | string) => {
                if (deferred.state === 'unresolved') {
                    stderr += data.toString();

                    if (tester(stdout, stderr)) {
                        deferred.resolve({ stdout, stderr });
                    }
                }
            });
        });
        return deferred.promise;
    }

    protected buildCmd(cmd: string, args?: string[]): string {
        const escapedArgs = args?.map(arg => `"${arg.replace(/"/g, '\\"')}"`) || [];
        const fullCmd = cmd + (escapedArgs.length > 0 ? (' ' + escapedArgs.join(' ')) : '');
        return fullCmd;
    }

    dispose(): void {
        this.client.destroy();
    }

}
