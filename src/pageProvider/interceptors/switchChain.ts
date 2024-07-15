import IconLux from "../../assets/lux.svg";
import IconWarning from "../../assets/warning.svg";
import IconArrow from "../../assets/arrow.svg";
import notice from "../notice";
import { isInSameOriginIframe } from "../../utils/iframe";

let instance: ReturnType<typeof notice> | null;

interface Chain {
  [key: string]: any;
  id: number;
  name: string;
  logo?: string;
  isTestnet: boolean;
}

export const switchChainNotice = (
  chain: Chain & {
    prev?: Chain;
  }
) => {
  if (isInSameOriginIframe()) {
    return;
  }
  if (instance) {
    instance.hide();
    instance = null;
  }

  const rawContent = `<img style="width: 20px; height: 20px; margin-right: 8px;" src="${IconLux}"/> <div style="color: #192945; padding-right: 2px;">Network switched to <span class="lux-strong" style="margin: 0;">${chain?.name}</span><div>`;
  let content = rawContent;

  instance = notice({
    timeout: 3000,
    content,
  });
};
