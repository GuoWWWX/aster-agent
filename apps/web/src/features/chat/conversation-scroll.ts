const DEFAULT_BOTTOM_THRESHOLD_PX = 32;

type ScrollPosition = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

export function isConversationScrolledToBottom(
  position: ScrollPosition,
  threshold = DEFAULT_BOTTOM_THRESHOLD_PX,
): boolean {
  return position.scrollHeight - position.clientHeight - position.scrollTop <= threshold;
}
