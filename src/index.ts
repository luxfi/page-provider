// this script is injected into webpage's context
import { EventEmitter } from "events";
import { ethErrors, serializeError } from "eth-rpc-errors";
import BroadcastChannelMessage from "./utils/message/broadcastChannelMessage";
import PushEventHandlers from "./pageProvider/pushEventHandlers";
import { domReadyCall, $ } from "./pageProvider/utils";
import ReadyPromise from "./pageProvider/readyPromise";
import DedupePromise from "./pageProvider/dedupePromise";
import { switchChainNotice } from "./pageProvider/interceptors/switchChain";
import { switchWalletNotice } from "./pageProvider/interceptors/switchWallet";
import { getProviderMode, patchProvider } from "./utils/metamask";

declare const __lux__channelName;
declare const __lux__isDefaultWallet;
declare const __lux__uuid;
declare const __lux__isOpera;

const log = (event, ...args) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `%c [lux] (${new Date().toTimeString().substr(0, 8)}) ${event}`,
      "font-weight: bold; background-color: #7d6ef9; color: white;",
      ...args
    );
  }
};

let channelName =
  typeof __lux__channelName !== "undefined" ? __lux__channelName : "";
let isDefaultWallet =
  typeof __lux__isDefaultWallet !== "undefined"
    ? __lux__isDefaultWallet
    : false;
let isOpera =
  typeof __lux__isOpera !== "undefined" ? __lux__isOpera : false;
let uuid = typeof __lux__uuid !== "undefined" ? __lux__uuid : "";

const getParams = () => {
  if (localStorage.getItem("lux:channelName")) {
    channelName = localStorage.getItem("lux:channelName") as string;
    localStorage.removeItem("lux:channelName");
  }
  if (localStorage.getItem("lux:isDefaultWallet")) {
    isDefaultWallet = localStorage.getItem("lux:isDefaultWallet") === "true";
    localStorage.removeItem("lux:isDefaultWallet");
  }
  if (localStorage.getItem("lux:uuid")) {
    uuid = localStorage.getItem("lux:uuid") as string;
    localStorage.removeItem("lux:uuid");
  }
  if (localStorage.getItem("lux:isOpera")) {
    isOpera = localStorage.getItem("lux:isOpera") === "true";
    localStorage.removeItem("lux:isOpera");
  }
};
getParams();

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

interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}
interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EthereumProvider;
}

interface EIP6963AnnounceProviderEvent extends CustomEvent {
  type: "eip6963:announceProvider";
  detail: EIP6963ProviderDetail;
}

interface EIP6963RequestProviderEvent extends Event {
  type: "eip6963:requestProvider";
}

export class EthereumProvider extends EventEmitter {
  chainId: string | null = null;
  selectedAddress: string | null = null;
  /**
   * The network ID of the currently connected Ethereum chain.
   * @deprecated
   */
  networkVersion: string | null = null;
  isLux = true;
  isMetaMask = true;
  _isLux = true;

  _isReady = false;
  _isConnected = false;
  _initialized = false;
  _isUnlocked = false;

  _cacheRequestsBeforeReady: any[] = [];
  _cacheEventListenersBeforeReady: [string | symbol, () => any][] = [];

  _state: StateProvider = {
    accounts: null,
    isConnected: false,
    isUnlocked: false,
    initialized: false,
    isPermanentlyDisconnected: false,
  };

  _metamask = {
    isUnlocked: () => {
      return new Promise((resolve) => {
        resolve(this._isUnlocked);
      });
    },
  };

  private _pushEventHandlers: PushEventHandlers;
  private _requestPromise = new ReadyPromise(2);
  private _dedupePromise = new DedupePromise([]);
  private _bcm = new BroadcastChannelMessage(channelName);

  constructor({ maxListeners = 100 } = {}) {
    super();
    this.setMaxListeners(maxListeners);
    this.initialize();
    this.shimLegacy();
    this._pushEventHandlers = new PushEventHandlers(this);
  }

  initialize = async () => {
    document.addEventListener(
      "visibilitychange",
      this._requestPromiseCheckVisibility
    );

    this._bcm.connect().on("message", this._handleBackgroundMessage);
    domReadyCall(() => {
      const origin = location.origin;
      const icon =
        ($('head > link[rel~="icon"]') as HTMLLinkElement)?.href ||
        ($('head > meta[itemprop="image"]') as HTMLMetaElement)?.content;

      const name =
        document.title ||
        ($('head > meta[name="title"]') as HTMLMetaElement)?.content ||
        origin;

      this._bcm.request({
        method: "tabCheckin",
        params: { icon, name, origin },
      });

      this._requestPromise.check(2);
    });

    try {
      const { chainId, accounts, networkVersion, isUnlocked }: any =
        await this.requestInternalMethods({
          method: "getProviderState",
        });
      if (isUnlocked) {
        this._isUnlocked = true;
        this._state.isUnlocked = true;
      }
      this.chainId = chainId;
      this.networkVersion = networkVersion;
      this.emit("connect", { chainId });
      this._pushEventHandlers.chainChanged({
        chain: chainId,
        networkVersion,
      });

      this._pushEventHandlers.accountsChanged(accounts);
    } catch {
      //
    } finally {
      this._initialized = true;
      this._state.initialized = true;
      this.emit("_initialized");
    }
  };

  private _requestPromiseCheckVisibility = () => {
    if (document.visibilityState === "visible") {
      this._requestPromise.check(1);
    } else {
      this._requestPromise.uncheck(1);
    }
  };

  private _handleBackgroundMessage = ({ event, data }) => {
    log("[push event]", event, data);
    if (this._pushEventHandlers[event]) {
      return this._pushEventHandlers[event](data);
    }

    this.emit(event, data);
  };

  isConnected = () => {
    return true;
  };

  // TODO: support multi request!
  request = async (data) => {
    if (!this._isReady) {
      const promise = new Promise((resolve, reject) => {
        this._cacheRequestsBeforeReady.push({
          data,
          resolve,
          reject,
        });
      });
      return promise;
    }
    return this._dedupePromise.call(data.method, () => this._request(data));
  };

  _request = async (data) => {
    if (!data) {
      throw ethErrors.rpc.invalidRequest();
    }

    this._requestPromiseCheckVisibility();

    return this._requestPromise.call(() => {
      if (data.method !== "eth_call") {
        log("[request]", JSON.stringify(data, null, 2));
      }

      return this._bcm
        .request(data)
        .then((res) => {
          if (data.method !== "eth_call") {
            log("[request: success]", data.method, res);
          }
          return res;
        })
        .catch((err) => {
          if (data.method !== "eth_call") {
            log("[request: error]", data.method, serializeError(err));
          }
          throw serializeError(err);
        });
    });
  };

  requestInternalMethods = (data) => {
    return this._dedupePromise.call(data.method, () => this._request(data));
  };

  // shim to matamask legacy api
  sendAsync = (payload, callback) => {
    if (Array.isArray(payload)) {
      return Promise.all(
        payload.map(
          (item) =>
            new Promise((resolve) => {
              this.sendAsync(item, (err, res) => {
                // ignore error
                resolve(res);
              });
            })
        )
      ).then((result) => callback(null, result));
    }
    const { method, params, ...rest } = payload;
    this.request({ method, params })
      .then((result) => callback(null, { ...rest, method, result }))
      .catch((error) => callback(error, { ...rest, method, error }));
  };

  send = (payload, callback?) => {
    if (typeof payload === "string" && (!callback || Array.isArray(callback))) {
      // send(method, params? = [])
      return this.request({
        method: payload,
        params: callback,
      }).then((result) => ({
        id: undefined,
        jsonrpc: "2.0",
        result,
      }));
    }

    if (typeof payload === "object" && typeof callback === "function") {
      return this.sendAsync(payload, callback);
    }

    let result;
    switch (payload.method) {
      case "eth_accounts":
        result = this.selectedAddress ? [this.selectedAddress] : [];
        break;

      case "eth_coinbase":
        result = this.selectedAddress || null;
        break;

      default:
        throw new Error("sync method doesnt support");
    }

    return {
      id: payload.id,
      jsonrpc: payload.jsonrpc,
      result,
    };
  };

  shimLegacy = () => {
    const legacyMethods = [
      ["enable", "eth_requestAccounts"],
      ["net_version", "net_version"],
    ];

    for (const [_method, method] of legacyMethods) {
      this[_method] = () => this.request({ method });
    }
  };

  on = (event: string | symbol, handler: (...args: any[]) => void) => {
    if (!this._isReady) {
      this._cacheEventListenersBeforeReady.push([event, handler]);
      return this;
    }
    return super.on(event, handler);
  };
}

declare global {
  interface Window {
    ethereum: EthereumProvider;
    web3: any;
    lux: EthereumProvider;
    luxWalletRouter: {
      luxProvider: EthereumProvider;
      lastInjectedProvider?: EthereumProvider;
      currentProvider: EthereumProvider;
      providers: EthereumProvider[];
      setDefaultProvider: (luxAsDefault: boolean) => void;
      addProvider: (provider: EthereumProvider) => void;
    };
  }
}

const provider = new EthereumProvider();
patchProvider(provider);
const luxProvider = new Proxy(provider, {
  deleteProperty: (target, prop) => {
    if (
      typeof prop === "string" &&
      ["on", "isLux", "isMetaMask", "_isLux"].includes(prop)
    ) {
      // @ts-ignore
      delete target[prop];
    }
    return true;
  },
});

const requestHasOtherProvider = () => {
  return provider.requestInternalMethods({
    method: "hasOtherProvider",
    params: [],
  });
};

const requestIsDefaultWallet = () => {
  return provider.requestInternalMethods({
    method: "isDefaultWallet",
    params: [],
  }) as Promise<boolean>;
};

const initOperaProvider = () => {
  window.ethereum = luxProvider;
  luxProvider._isReady = true;
  window.lux = luxProvider;
  patchProvider(luxProvider);
  luxProvider.on("lux:chainChanged", switchChainNotice);
};

const initProvider = () => {
  luxProvider._isReady = true;
  luxProvider.on("defaultWalletChanged", switchWalletNotice);
  patchProvider(luxProvider);
  if (window.ethereum) {
    requestHasOtherProvider();
  }
  if (!window.web3) {
    window.web3 = {
      currentProvider: luxProvider,
    };
  }
  const descriptor = Object.getOwnPropertyDescriptor(window, "ethereum");
  const canDefine = !descriptor || descriptor.configurable;
  if (canDefine) {
    try {
      Object.defineProperties(window, {
        lux: {
          value: luxProvider,
          configurable: false,
          writable: false,
        },
        ethereum: {
          get() {
            return window.luxWalletRouter.currentProvider;
          },
          set(newProvider) {
            window.luxWalletRouter.addProvider(newProvider);
          },
          configurable: false,
        },
        luxWalletRouter: {
          value: {
            luxProvider,
            lastInjectedProvider: window.ethereum,
            currentProvider: luxProvider,
            providers: [
              luxProvider,
              ...(window.ethereum ? [window.ethereum] : []),
            ],
            setDefaultProvider(luxAsDefault: boolean) {
              if (luxAsDefault) {
                window.luxWalletRouter.currentProvider = window.lux;
              } else {
                const nonDefaultProvider =
                  window.luxWalletRouter.lastInjectedProvider ??
                  window.ethereum;
                window.luxWalletRouter.currentProvider = nonDefaultProvider;
              }
              if (
                luxAsDefault ||
                !window.luxWalletRouter.lastInjectedProvider
              ) {
                luxProvider.on("lux:chainChanged", switchChainNotice);
              }
            },
            addProvider(provider) {
              if (!window.luxWalletRouter.providers.includes(provider)) {
                window.luxWalletRouter.providers.push(provider);
              }
              if (luxProvider !== provider) {
                requestHasOtherProvider();
                window.luxWalletRouter.lastInjectedProvider = provider;
              }
            },
          },
          configurable: false,
          writable: false,
        },
      });
    } catch (e) {
      // think that defineProperty failed means there is any other wallet
      requestHasOtherProvider();
      console.error(e);
      window.ethereum = luxProvider;
      window.lux = luxProvider;
    }
  } else {
    window.ethereum = luxProvider;
    window.lux = luxProvider;
  }
};

if (isOpera) {
  initOperaProvider();
} else {
  initProvider();
}

requestIsDefaultWallet().then((luxAsDefault) => {
  window.luxWalletRouter?.setDefaultProvider(luxAsDefault);
});

const announceEip6963Provider = (provider: EthereumProvider) => {
  const info: EIP6963ProviderInfo = {
    uuid: uuid,
    name: "Lux Wallet",
    icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAsTAAALEwEAmpwYAAADkElEQVR4nO2bv0sbUQDHP0lVRNCCUKhIhizSYAO1qbg1k0PTiuBg6Q8lmRwdXKogiCD+AUGchG4OipPipoPSoksGtdo6dIh1CagtVZfU1yF3aRqTXn689/Js/MIXCRzvvp/vXc673Hsu1OsO8BDwAw8AD3AP8AKt1jbfgK9AAogDB8AOsAv80pBRuu4DEWCeFJAo0XFrjIg1pvEKAYvAJaVD5/MlsAA800ZThF4C28iHzudta58VVxD4iD7wbH8AniqnzCE3EC0yrEpHrUxa9ITUVbrS0Nk+AAIKuQEYMADUyW9VwY8ZAFeox2TDTxgAVawnZMGPGgBTqt+VC//KAIhyXfL9gs+A8LLsK6WAIwOCy/JRsfCzBoSW7dlC4TsMCKvKjwsp4JMBQVV51wn+hQEhVfv5vwow8R5ftj/ngw8aEE6Xg7kKWDEgmC6v2NAu628T8D1XK/+x7gI/aqwPfTJGbGtro66ujmQyKWO4a3K5XNTX1xOLxWQM1we8tz8sIuHU6unpEao1Pj4u62uwaMO7Sf0eL2XgjY0NZfCnp6fC7XbLKiBhsdMuCx4QLS0tygro7u6WfTFsBwU/c01NTUmHX1tbkw0vLHamFQwszs7OpBbg8XhUFDDt5s/7OakaGhqSNlY0GiUej0sbL0OtAKsoOAMAEYvFyj7y5+fnoqamRkk+i50vqgrw+/1lFzA4OKgKXljs/FS4AzE/P18y/P7+vkp4YbGrLaCxsVFcXV2VVEBnZ6eWApR9BWyPjIwUDb+0tKQaXljs6i6CmT4+Pi6qgObmZh0FrNq3wcoViUQK3nZycpKTkxOFadJKgKIboVxeX193PPKJREJLFsvToPGNr9frdSygt7dXZwEDIPlhyMkzMzN54be2tnTCC4td7uOwk2tra8XFxUXOAnw+n0749OMwpGZfadt5OBy+Bj83N6f76C+QobDmnYvDw8M0fDKZFA0NDboLCGcW0KS7gK6urnQBw8PDuuGFxfyXlnWH2NvbE0KISsAvZ8NDar6d1iCBQECEQqFKFJB3bmFVvxqD25ejAOwZEFKVd5zgAR4ZEFSVOwopAKp8ioytqp4kBbfT5IDUJMNKhy/X/aXC26rqqbK2JgyAKdYTsuBt3aQzYVQ2vK03BsA5+bUqeFtVvWTGVlUvmspUENgsMqxMb1KhZXPZ6kf/wsmy/7+rUNUunc3WjVk87XLepGwZvXz+NwxdZcetDvfKAAAAAElFTkSuQmCC",
    rdns: "io.lux",
  };

  window.dispatchEvent(
    new CustomEvent("eip6963:announceProvider", {
      detail: Object.freeze({ info, provider }),
    })
  );
};

window.addEventListener<any>(
  "eip6963:requestProvider",
  (event: EIP6963RequestProviderEvent) => {
    announceEip6963Provider(luxProvider);
  }
);

announceEip6963Provider(luxProvider);

window.dispatchEvent(new Event("ethereum#initialized"));
