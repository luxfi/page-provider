/// <reference types="node" />
import { EventEmitter } from "events";
export interface Interceptor {
    onRequest?: (data: any) => any;
    onResponse?: (res: any, data: any) => any;
}
interface StateProvider {
    accounts: string[] | null;
    isConnected: boolean;
    isUnlocked: boolean;
    initialized: boolean;
    isPermanentlyDisconnected: boolean;
}
export declare class EthereumProvider extends EventEmitter {
    chainId: string | null;
    selectedAddress: string | null;
    /**
     * The network ID of the currently connected Ethereum chain.
     * @deprecated
     */
    networkVersion: string | null;
    isLux: boolean;
    isMetaMask: boolean;
    _isConnected: boolean;
    _initialized: boolean;
    _isUnlocked: boolean;
    _state: StateProvider;
    _metamask: {
        isUnlocked: () => Promise<unknown>;
    };
    private _pushEventHandlers;
    private _requestPromise;
    private _dedupePromise;
    private _bcm;
    constructor({ maxListeners }?: {
        maxListeners?: number | undefined;
    });
    initialize: () => Promise<void>;
    private _requestPromiseCheckVisibility;
    private _handleBackgroundMessage;
    isConnected: () => boolean;
    request: (data: any) => Promise<unknown>;
    _request: (data: any) => Promise<unknown>;
    sendAsync: (payload: any, callback: any) => Promise<any> | undefined;
    send: (payload: any, callback?: any) => Promise<any> | {
        id: any;
        jsonrpc: any;
        result: any;
    } | undefined;
    shimLegacy: () => void;
}
declare global {
    interface Window {
        ethereum: EthereumProvider;
    }
}
export {};
