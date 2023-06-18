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

import { ContainerModule } from '@theia/core/shared/inversify';
import { BackendApplicationContribution, CliContribution, MessagingService } from '@theia/core/lib/node';
import { RemoteExpressProxyContribution } from './remote-express-proxy-contribution';
import { RemoteConnectionService } from './remote-connection-service';
import { RemoteProxyServerProvider } from './remote-proxy-server-provider';
import { RemoteRedirectContribution } from './remote-redirect-contribution';
import { RemoteConnectionSocketProvider } from './remote-connection-socket-provider';
import { RemoteTunnelService } from './remote-tunnel-service';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { RemoteSSHConnectionProvider, RemoteSSHConnectionProviderPath } from '../common/remote-ssh-connection-provider';
import { RemoteSSHConnectionProviderImpl } from './ssh/remote-ssh-connection-provider';
import { SSHIdentityFileCollector } from './ssh/ssh-identity-file-collector';
import { RemoteCopyService } from './remote-copy-service';
import { RemoteSetupService } from './remote-setup-service';
import { RemoteNativeDependencyService } from './remote-native-dependency-service';
import { BackendRemoteServiceImpl } from './backend-remote-service-impl';
import { BackendRemoteService } from '@theia/core/lib/node/remote/backend-remote-service';

export const remoteConnectionModule = ConnectionContainerModule.create(({ bind, bindBackendService }) => {
    bind(RemoteSSHConnectionProviderImpl).toSelf().inSingletonScope();
    bind(RemoteSSHConnectionProvider).toService(RemoteSSHConnectionProviderImpl);
    bindBackendService(RemoteSSHConnectionProviderPath, RemoteSSHConnectionProvider);
});

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(RemoteCopyService).toSelf().inSingletonScope();
    bind(RemoteSetupService).toSelf().inSingletonScope();
    bind(RemoteNativeDependencyService).toSelf().inSingletonScope();
    bind(RemoteProxyServerProvider).toSelf().inSingletonScope();
    bind(RemoteConnectionSocketProvider).toSelf().inSingletonScope();
    bind(RemoteTunnelService).toSelf().inSingletonScope();
    bind(RemoteConnectionService).toSelf().inSingletonScope();
    bind(RemoteExpressProxyContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(RemoteExpressProxyContribution);

    bind(RemoteRedirectContribution).toSelf().inSingletonScope();
    bind(MessagingService.RedirectContribution).toService(RemoteRedirectContribution);
    bind(ConnectionContainerModule).toConstantValue(remoteConnectionModule);

    bind(BackendRemoteServiceImpl).toSelf().inSingletonScope();
    rebind(BackendRemoteService).toService(BackendRemoteServiceImpl);
    bind(CliContribution).toService(BackendRemoteServiceImpl);

    bind(SSHIdentityFileCollector).toSelf().inSingletonScope();
});
