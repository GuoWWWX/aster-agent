import { NATIVE_OVERLAY_READY } from "./lib/native-overlay.js";
import "./styles/index.css";

for (const element of [document.documentElement, document.body]) {
  element.style.setProperty("background", "transparent", "important");
  element.style.setProperty("margin", "0", "important");
  element.style.setProperty("overflow", "hidden", "important");
}
const opener = window.opener as Window | null;
opener?.postMessage(NATIVE_OVERLAY_READY, location.origin === "null" ? "*" : location.origin);
