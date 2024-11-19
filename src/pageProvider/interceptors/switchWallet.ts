import IconMetamask from "../../assets/metamask.svg";
import IconLux from "../../assets/lux.svg";
import notice from "../notice";
import { isInSameOriginIframe } from "../../utils/iframe";

let instance: ReturnType<typeof notice> | null;

export const switchWalletNotice = (type: "lux" | "metamask") => {
  if (isInSameOriginIframe()) {
    return;
  }
  const titles = {
    lux: "Lux",
    metamask: "MetaMask",
  };
  if (instance) {
    instance.hide();
    instance = null;
  }
  instance = notice({
    closeable: true,
    timeout: 0,
    className: "lux-notice-default-wallet",
    content: `<div style="display: flex; align-items: center; gap: 12px; color: #192945;">
      <img style="width: 28px;" src="${
        type === "lux" ? IconLux : IconMetamask
      }"/>
      <div style="color: #192945;">
        <div style="color: #192945;"><span style="font-weight: bold; color: #192945;">${
          titles[type]
        }</span> is your default wallet now. </div>
        <div style="color: #192945;">
        Please <a
          href="javascript:window.location.reload();"
          style="color: #7084FF; text-decoration: underline;">refresh the web page</a> 
        and retry
        </div>
      </div>
    </div>
    `,
  });
};
