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

import { Endpoint } from '../../browser/endpoint';
import { CookieService } from '../../browser/cookies';

export class ElectronCookieService extends CookieService {

    override set(name: string, value: string): void {
        window.electronTheiaCore.setCookie(this.getEndpoint(), name, value);
    }

    override remove(name: string): void {
        window.electronTheiaCore.removeCookie(this.getEndpoint(), name);
    }

    protected getEndpoint(): string {
        return new Endpoint().getRestUrl().toString(true);
    }
}
