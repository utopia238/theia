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

import * as express from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ExpressLayer, RemoteConnection } from './remote-types';
import { AddressInfo, Server } from 'net';
import expressHttpProxy = require('express-http-proxy');
import { getCookies } from './remote-utils';
import { Disposable } from '@theia/core';
import { RemoteConnectionService } from './remote-connection-service';

@injectable()
export class RemoteExpressProxyContribution implements BackendApplicationContribution {

    @inject(RemoteConnectionService)
    protected remoteConnectionService: RemoteConnectionService;

    protected app: express.Application;

    configure(app: express.Application): void {
        this.app = app;
        app.get('/remote/status', (req, res) => {
            const cookies = getCookies(req);
            const remoteId = cookies.remoteId;
            if (remoteId) {
                const remote = this.remoteConnectionService.getConnection(remoteId);
                if (remote) {
                    res.send({
                        alive: true,
                        name: remote.name,
                        type: remote.type
                    });
                    return;
                }
            }
            res.send({
                alive: false
            });
        });
        this.spliceRouter(this.app, router => router.name === 'serveStatic' ? 0 : undefined);
    }

    setupProxyRouter(remote: RemoteConnection, server: Server): Disposable {
        const port = (server.address() as AddressInfo).port.toString();
        const handleProxy = expressHttpProxy(`http://localhost:${port}`, {
            filter: req => {
                const cookies = getCookies(req);
                const remoteId = cookies.remoteId;
                return remoteId === remote.id;
            }
        });
        this.app.use(handleProxy);
        return this.spliceRouter(this.app, router => router.name === 'serveStatic' ? 1 : undefined);
    }

    protected spliceRouter(app: express.Application, position: (router: ExpressLayer) => number | undefined): Disposable {
        const routerStack: ExpressLayer[] = app._router.stack;
        if (routerStack.length > 0) {
            const router = routerStack.splice(routerStack.length - 1, 1)[0];
            for (let i = 0; i < routerStack.length - 1; i++) {
                const index = position(routerStack[i]);
                if (index !== undefined) {
                    routerStack.splice(i + index + 1, 0, router);
                    return Disposable.create(() => {
                        const currentIndex = routerStack.indexOf(router);
                        routerStack.splice(currentIndex, 1);
                    });
                }
            }
        }
        return Disposable.NULL;
    }
}
