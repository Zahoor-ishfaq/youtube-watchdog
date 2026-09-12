/**
 * Message contracts between the content script / popup and the service worker.
 */
import type { Quote } from './quotes';
import type { Sensitivity } from './settings';

export interface CheckVideoRequest {
  type: 'CHECK_VIDEO';
  videoTitle: string;
  channelName: string;
  userTopic: string;
  sensitivity: Sensitivity;
}

export interface GetStatusRequest {
  type: 'GET_STATUS';
}

/** A quote with no relevance check, used for Shorts which are flagged outright. */
export interface GetQuoteRequest {
  type: 'GET_QUOTE';
}

/** Ask the service worker to start loading the model now (e.g. right after saving a topic). */
export interface WarmUpRequest {
  type: 'WARM_UP';
}

export type Request = CheckVideoRequest | GetStatusRequest | WarmUpRequest | GetQuoteRequest;

export type CheckVideoResponse =
  | { relevant: true; score: number | null }
  | { relevant: false; score: number; quote: Quote };

export interface ModelStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  /** 0–100 while loading. */
  progress: number;
  message?: string;
}

export function isRequest(message: unknown): message is Request {
  if (typeof message !== 'object' || message === null) return false;
  const type = (message as { type?: unknown }).type;
  return type === 'CHECK_VIDEO' || type === 'GET_STATUS' || type === 'WARM_UP' || type === 'GET_QUOTE';
}
