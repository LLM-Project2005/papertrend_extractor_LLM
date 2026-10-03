/*
 * src/components/chat/ChatIntro.tsx for chat page render tests (see
 * route-harness.ts): the real components, with the props the page last gave
 * ChatIntro kept in globalThis.__chatAnswerIntroProps so a test can do what a
 * click on an example does.
 */
import { createElement } from "react";
import * as real from "../../src/components/chat/ChatIntro";

type IntroProps = Parameters<typeof real.ChatIntro>[0];

declare global {
  // eslint-disable-next-line no-var
  var __chatAnswerIntroProps: IntroProps | undefined;
}

export const FollowUpSuggestions = real.FollowUpSuggestions;

export function ChatIntro(props: IntroProps) {
  globalThis.__chatAnswerIntroProps = props;
  return createElement(real.ChatIntro, props);
}
