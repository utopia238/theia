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

import { Command, CommandContribution, CommandRegistry, ContributionProvider, nls, QuickInputService, QuickPickInput } from '@theia/core';
import { CookieService, Endpoint, FrontendApplicationContribution, StatusBar, StatusBarAlignment, StatusBarEntry } from '@theia/core/lib/browser';
import { inject, injectable, named, optional } from '@theia/core/shared/inversify';
import { RemoteStatus, REMOTE_ID } from '../common/remote-types';
import { RemoteRegistry, RemoteRegistryContribution } from './remote-registry-contribution';
import { RemoteServiceImpl } from './remote-service-impl';

export namespace RemoteCommands {
    export const REMOTE_SELECT: Command = {
        id: 'remote.select'
    };
    export const REMOTE_DISCONNECT: Command = Command.toDefaultLocalizedCommand({
        id: 'remote.disconnect',
        label: 'Close Remote Connection',
    });
}

@injectable()
export class RemoteFrontendContribution implements CommandContribution, FrontendApplicationContribution {

    @inject(StatusBar)
    protected readonly statusBar: StatusBar;

    @inject(CookieService)
    protected readonly cookieService: CookieService;

    @inject(QuickInputService) @optional()
    protected readonly quickInputService?: QuickInputService;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(RemoteServiceImpl)
    protected readonly remoteService: RemoteServiceImpl;

    @inject(ContributionProvider) @named(RemoteRegistryContribution)
    protected readonly remoteRegistryContributions: ContributionProvider<RemoteRegistryContribution>;

    protected remoteRegistry = new RemoteRegistry();

    async configure(): Promise<void> {
        const response = await fetch(new Endpoint({ path: '/remote/status' }).getRestUrl().toString());
        const info = await response.json() as RemoteStatus;
        await this.setStatusBar(info);
    }

    protected async setStatusBar(info: RemoteStatus): Promise<void> {
        this.remoteService.connected = info.alive;
        const entry: StatusBarEntry = {
            alignment: StatusBarAlignment.LEFT,
            command: RemoteCommands.REMOTE_SELECT.id,
            backgroundColor: 'var(--theia-statusBarItem-remoteBackground)',
            color: 'var(--theia-statusBarItem-remoteForeground)',
            priority: 10000,
            ...(info.alive
                ? {
                    text: `$(codicon-remote) ${info.type}: ${info.name.length > 30 ? info.name.substring(0, 30) + '...' : info.name}`,
                    tooltip: nls.localizeByDefault('Editing on {0}', info.name),
                } : {
                    text: '$(codicon-remote)',
                    tooltip: nls.localizeByDefault('Open a Remote Window'),
                })
        };
        this.statusBar.setElement('remoteInfo', entry);
    }

    registerCommands(commands: CommandRegistry): void {
        this.remoteRegistry.onDidRegisterCommand(([command, handler]) => {
            commands.registerCommand(command, handler && {
                isEnabled: () => !this.remoteService.isConnected(),
                ...handler
            });
        });
        for (const contribution of this.remoteRegistryContributions.getContributions()) {
            contribution.registerRemoteCommands(this.remoteRegistry);
        }
        commands.registerCommand(RemoteCommands.REMOTE_SELECT, {
            execute: () => this.selectRemote()
        });
        commands.registerCommand(RemoteCommands.REMOTE_DISCONNECT, {
            execute: () => this.disconnectRemote()
        });
    }

    protected disconnectRemote(): void {
        this.cookieService.remove(REMOTE_ID);
        window.location.reload();
    }

    protected async selectRemote(): Promise<void> {
        const commands = this.remoteService.isConnected()
            ? [RemoteCommands.REMOTE_DISCONNECT]
            : this.remoteRegistry.commands;
        const quickPicks: QuickPickInput[] = [];
        let previousCategory: string | undefined = undefined;
        for (const command of commands) {
            if (previousCategory !== command.category) {
                quickPicks.push({
                    type: 'separator',
                    label: command.category
                });
                previousCategory = command.category;
            }
            quickPicks.push({
                label: command.label!,
                id: command.id
            });
        }
        const selection = await this.quickInputService?.showQuickPick(quickPicks, {
            placeholder: nls.localizeByDefault('Select an option to connect to a Remote Window')
        });
        if (selection) {
            this.commandRegistry.executeCommand(selection.id!);
        }
    }

}
