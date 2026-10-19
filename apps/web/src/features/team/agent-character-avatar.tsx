import type { ReactElement, ReactNode } from "react";
import type { AgentAvatarPreset } from "@agent/protocol";

export const AGENT_AVATAR_PRESET_OPTIONS = [
  { id: "orbit", label: "阿圆" }, { id: "pixel", label: "方方" },
  { id: "sprout", label: "芽芽" }, { id: "ember", label: "小橘" },
  { id: "luna", label: "月牙" }, { id: "cloud", label: "云朵" },
  { id: "robot", label: "小机灵" }, { id: "fox", label: "小狐狸" },
  { id: "cat", label: "夜猫" }, { id: "panda", label: "团团" },
  { id: "astro", label: "星航" }, { id: "owl", label: "咕咕" },
] as const satisfies readonly { id: AgentAvatarPreset; label: string }[];

const INK = "#233047";
const HEADS: Record<AgentAvatarPreset, ReactNode> = {
  orbit: <path d="M9 32C9 17 18 9 33 9s23 10 23 24S47 57 32 57 9 48 9 32" fill="#F6BD61" />,
  pixel: <rect x="9" y="10" width="46" height="46" rx="13" fill="#8BBBF1" />,
  sprout: <>
    <path d="M32 18C20 18 11 27 11 39s9 19 21 19 21-7 21-19-9-21-21-21" fill="#9AD19D" />
    <path d="M32 21V10M32 15C21 15 22 6 22 6c10-1 10 9 10 9M32 16s0-11 12-10c1 8-6 10-12 10" fill="#5A9B70" stroke="#39734E" strokeWidth="1.6" strokeLinecap="round" />
  </>,
  ember: <path d="M14 23C17 14 26 8 35 9c14 1 20 12 20 24 0 16-10 25-24 25S8 48 9 35c0-5 2-9 5-12" fill="#F19D79" />,
  luna: <>
    <path d="M10 33C9 18 19 9 32 9s24 9 23 24c-1 15-8 24-23 24S11 48 10 33" fill="#C5B4EE" />
    <path d="m44 8 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#F6D77E" />
  </>,
  cloud: <path d="M15 22C14 10 28 7 34 15c8-8 21-2 19 10 10 8 5 23-6 25-9 12-21 11-29 2C6 53 2 38 10 31c-1-4 0-7 5-9" fill="#B8DDEB" />,
  robot: <>
    <path d="M32 8v8" stroke={INK} strokeWidth="2.5" /><circle cx="32" cy="6" r="4" fill="#EEA39D" />
    <rect x="5" y="29" width="7" height="13" rx="3" fill="#82AFC5" /><rect x="52" y="29" width="7" height="13" rx="3" fill="#82AFC5" />
    <rect x="10" y="16" width="44" height="40" rx="12" fill="#A6D2DF" /><rect x="16" y="23" width="32" height="26" rx="9" fill="#E4F2EC" />
  </>,
  fox: <>
    <path d="m12 29-2-23 17 13h10L54 6l-2 23c5 19-5 29-20 29S7 48 12 29" fill="#EFA16D" />
    <path d="m15 13 2 14 7-7Zm34 0-9 7 7 7Z" fill="#F7D7BB" />
    <path d="M12 35c6-1 14 0 20 9 6-9 14-10 20-9-1 15-9 23-20 23S13 50 12 35" fill="#FFF0D7" />
  </>,
  cat: <>
    <path d="m12 27 1-21 16 13h6L51 6l1 21c10 20-2 31-20 31S2 47 12 27" fill="#A0ACC9" />
    <path d="m17 15 1 12 8-6Zm30 0-9 6 8 6Z" fill="#E4B4BF" />
    <path d="m9 40 12 2M8 46l13-1m34-5-12 2m13 4-13-1" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
  </>,
  panda: <>
    <circle cx="15" cy="16" r="10" fill="#48516A" /><circle cx="49" cy="16" r="10" fill="#48516A" />
    <ellipse cx="32" cy="35" rx="25" ry="24" fill="#F1E8D5" />
    <ellipse cx="21" cy="32" rx="8" ry="10" transform="rotate(25 21 32)" fill="#48516A" />
    <ellipse cx="43" cy="32" rx="8" ry="10" transform="rotate(-25 43 32)" fill="#48516A" />
  </>,
  astro: <>
    <path d="M7 35C6 14 18 5 32 5s26 9 25 30l-4 18H11Z" fill="#D5E5F1" />
    <ellipse cx="32" cy="33" rx="20" ry="23" fill="#CA9274" />
    <path d="M12 28C10 14 21 8 32 9s21 6 20 18c-9-1-14-7-16-10-5 9-16 8-24 11" fill="#6D4C43" />
    <path d="m20 56 12-4 12 4 7 8H13Z" fill="#82ABC9" />
  </>,
  owl: <>
    <path d="m10 8 15 9h14l15-9-2 18c10 21 0 33-20 33S2 47 12 26Z" fill="#84B4AF" />
    <path d="M10 31c0-12 15-17 22-6 7-11 22-6 22 6s-11 15-22 22C21 46 10 43 10 31" fill="#E7E4C9" />
    <path d="m28 41 4 6 4-6Z" fill="#D39150" />
  </>,
};

/** Original, static vector characters stay readable at sidebar and mention sizes. */
export function AgentCharacterAvatar({ preset }: { preset: AgentAvatarPreset }): ReactElement {
  const eyeY = preset === "sprout" ? 35 : 32;
  const animal = preset === "fox" || preset === "cat" || preset === "panda" || preset === "owl";
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 64 64">
    {HEADS[preset]}
    {preset === "astro" ? <g fill="none" stroke={INK} strokeWidth="2"><circle cx="22" cy="33" r="7" /><circle cx="42" cy="33" r="7" /><path d="M29 33h6M9 31l6 1m34 0 6-1" /></g> : null}
    {preset === "owl" ? <><circle cx="22" cy="32" r="8" fill="#FFF9E8" /><circle cx="42" cy="32" r="8" fill="#FFF9E8" /></> : null}
    {preset === "panda" ? <><ellipse cx="22" cy={eyeY} rx="3" ry="4" fill="#FFF9ED" /><ellipse cx="42" cy={eyeY} rx="3" ry="4" fill="#FFF9ED" /></> : <g fill={INK}>
      <rect x="19" y={eyeY - 4} width="6" height="9" rx="3" />
      {preset === "ember" ? <path d="m39 33 4-2 4 2" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" /> : <rect x="39" y={eyeY - 4} width="6" height="9" rx="3" />}
      <circle cx="21" cy={eyeY - 2} r="1.2" fill="#FFF9EC" />
      {preset === "ember" ? null : <circle cx="41" cy={eyeY - 2} r="1.2" fill="#FFF9EC" />}
    </g>}
    {animal ? preset === "owl" ? null : <><path d="m29 42 3 3 3-3Z" fill={INK} /><path d="M32 45v3m0 0c-3 3-5 1-6 0m6 0c3 3 5 1 6 0" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" /></> : <>
      <ellipse cx="15" cy={eyeY + 8} rx="3.5" ry="2.3" fill="#DF7C79" opacity=".6" /><ellipse cx="49" cy={eyeY + 8} rx="3.5" ry="2.3" fill="#DF7C79" opacity=".6" />
      <path d={preset === "pixel" ? "M27 44h10" : `M27 ${eyeY + 12}q5 5 10 0`} fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
    </>}
  </svg>;
}
