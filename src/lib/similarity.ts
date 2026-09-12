/**
 * On-device semantic similarity using Xenova/all-MiniLM-L6-v2 (384-dim sentence
 * embeddings, ~23 MB quantized ONNX). Runs inside the extension service worker
 * on the WebAssembly backend. The model is downloaded once from the Hugging Face
 * Hub and persisted in the browser Cache API.
 */
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { isLexicalMatch } from './lexical';
import type { ModelStatus } from './messages';
import { cosineSimilarity } from './vector';

export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/**
 * The topic is embedded as a short phrase rather than a bare noun. Measured on
 * the calibration set, this one change cut false alarms from 7/15 to 1/15 at
 * the best threshold, because it puts the topic in the same register as a
 * video title. Changing it invalidates the thresholds in settings.ts — re-run
 * `npm run calibrate` if you touch it.
 */
const topicPrompt = (topic: string): string => `studying ${topic}`;

/** Shipped in dist/ by esbuild.config.mjs — keep the two names in sync. */
export const ORT_WASM_FILE = 'ort-wasm-simd-threaded.jsep.wasm';

let extractor: FeatureExtractionPipeline | null = null;
let loadingPromise: Promise<FeatureExtractionPipeline> | null = null;
let runtimeConfigured = false;
let status: ModelStatus = { state: 'idle', progress: 0 };

/** The topic rarely changes; keep its embedding so each check embeds only the video text. */
const topicCache = new Map<string, Float32Array>();

function configureRuntime(): void {
  if (runtimeConfigured) return;
  runtimeConfigured = true;

  env.allowLocalModels = false; // never probe the extension origin for model files
  env.allowRemoteModels = true; // Hugging Face Hub only (env.remoteHost default)
  env.useBrowserCache = true; // Cache API keeps the download across service-worker restarts

  const wasm = env.backends.onnx?.wasm;
  if (wasm) {
    wasm.numThreads = 1; // service workers cannot spawn Web Workers
    wasm.proxy = false;
    // Only the .wasm binary is overridden; the JS loader stays embedded in the bundle,
    // which matters because dynamic import() is not allowed in service workers.
    wasm.wasmPaths = { wasm: chrome.runtime.getURL(ORT_WASM_FILE) };
  }
}

interface ProgressEvent {
  status: string;
  file?: string;
  progress?: number;
}

function onProgress(event: ProgressEvent): void {
  if (event.status === 'ready') {
    status = { state: 'ready', progress: 100 };
    return;
  }
  // The ONNX weights dominate the download; report their progress as the overall figure.
  if (event.status === 'progress' && event.file?.endsWith('.onnx') && typeof event.progress === 'number') {
    status = { state: 'loading', progress: Math.max(status.progress, Math.min(99, Math.round(event.progress))) };
  }
}

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;

  if (!loadingPromise) {
    configureRuntime();
    status = { state: 'loading', progress: 0 };
    loadingPromise = pipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8',
      progress_callback: onProgress,
    }).then(
      (p) => {
        extractor = p;
        status = { state: 'ready', progress: 100 };
        return p;
      },
      (error: unknown) => {
        loadingPromise = null; // allow a retry on the next call
        const message = error instanceof Error ? error.message : String(error);
        status = { state: 'error', progress: 0, message };
        throw error;
      },
    );
  }
  return loadingPromise;
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  const model = await getExtractor();
  const output = await model(texts, { pooling: 'mean', normalize: true });
  const dim = output.dims[output.dims.length - 1] ?? 0;
  const data = output.data as Float32Array;
  return texts.map((_, i) => data.slice(i * dim, (i + 1) * dim));
}

async function embedTopic(topic: string): Promise<Float32Array> {
  const cached = topicCache.get(topic);
  if (cached) return cached;
  const [vec] = await embed([topic]);
  if (!vec) throw new Error('Empty embedding');
  if (topicCache.size > 20) topicCache.clear();
  topicCache.set(topic, vec);
  return vec;
}

export interface RelevanceResult {
  /** The primary signal: how well the title matches the topic. */
  score: number;
  titleScore: number;
  channelScore: number | null;
  /** The title or channel literally repeats the topic; forces "relevant". */
  lexicalMatch: boolean;
}

/**
 * Scores how related a video is to the user's topic.
 *
 * The title is the primary signal. The channel is reported alongside it but is
 * judged against its own, much higher bar by isVideoRelevant: combining the two
 * with Math.max() used to let channel noise drag off-topic videos over the
 * line. "Rick Astley" scores 0.15 against "studying AWS certification", which
 * was enough to wave the music video through.
 */
export async function scoreRelevance(
  userTopic: string,
  videoTitle: string,
  channelName = '',
): Promise<RelevanceResult> {
  const topicVec = await embedTopic(topicPrompt(userTopic));
  const texts = channelName ? [videoTitle, channelName] : [videoTitle];
  const [titleVec, channelVec] = await embed(texts);
  if (!titleVec) throw new Error('Empty embedding');

  const titleScore = cosineSimilarity(topicVec, titleVec);
  const channelScore = channelVec ? cosineSimilarity(topicVec, channelVec) : null;
  const lexicalMatch = isLexicalMatch(userTopic, videoTitle) || isLexicalMatch(userTopic, channelName);

  return { score: titleScore, titleScore, channelScore, lexicalMatch };
}

/**
 * A video is left alone when any one of three independent signals says it
 * belongs: the title matches, the channel strongly matches, or the title
 * literally repeats the topic. Each can only rescue a video, so the errors they
 * make are misses rather than interruptions.
 */
export async function isVideoRelevant(
  userTopic: string,
  videoTitle: string,
  channelName: string,
  threshold: number,
  channelThreshold: number,
): Promise<{ relevant: boolean; result: RelevanceResult | null }> {
  if (!userTopic || !videoTitle) return { relevant: true, result: null }; // safe default
  const result = await scoreRelevance(userTopic, videoTitle, channelName);
  const relevant =
    result.lexicalMatch ||
    result.titleScore >= threshold ||
    (result.channelScore !== null && result.channelScore >= channelThreshold);
  return { relevant, result };
}

/** Pre-load the model so the first check is fast. */
export async function warmUpModel(): Promise<void> {
  await getExtractor();
}

export function getModelStatus(): ModelStatus {
  return status;
}
