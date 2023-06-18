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

import { inject, injectable } from '@theia/core/shared/inversify';
import { MessagingService } from '@theia/core/lib/node/messaging/messaging-service';
import { Socket } from 'socket.io';
import { RemoteTunnelService } from './remote-tunnel-service';
import { RemoteConnectionSocketProvider } from './remote-connection-socket-provider';
import { getCookies } from './remote-utils';

@injectable()
export class RemoteRedirectContribution implements MessagingService.RedirectContribution {

    @inject(RemoteTunnelService)
    protected readonly sessionService: RemoteTunnelService;

    @inject(RemoteConnectionSocketProvider)
    protected readonly socketProvider: RemoteConnectionSocketProvider;

    async redirect(socket: Socket): Promise<boolean> {
        const cookies = getCookies(socket.request);
        const remoteId = cookies.remoteId;
        if (!remoteId) {
            return false;
        }
        try {
            const proxySession = await this.sessionService.addTunnel({
                remote: remoteId
            });
            const proxySocket = this.socketProvider.getProxySocket({
                port: proxySession.port,
                path: socket.nsp.name
            });
            proxySession.onDidRemoteDisconnect(() => {
                socket.disconnect(true);
            });
            socket.addListener('disconnect', () => {
                proxySocket.close();
                proxySession.dispose();
            });
            proxySocket.onAny((event, ...args) => {
                socket.emit(event, ...args);
            });
            socket.onAny((event, ...args) => {
                proxySocket.emit(event, ...args);
            });
            return true;
        } catch {
            // The remote session might no longer be valid
            // We simply return false and continue normal operation
            return false;
        }
    }
}
