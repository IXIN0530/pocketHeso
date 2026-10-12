/** Core のスキーマ版数。保存データと Atlas の互換判定に使う。 */
export const CORE_VERSION = 1;

export type { Vec2 } from './vec2.ts';
export { addVec2, dotVec2, lengthSquaredVec2, lengthVec2, scaleVec2, subVec2, vec2 } from './vec2.ts';
export type { RNGStreamID } from './rng.ts';
export { RNG_STREAM_IDS, RNGStream, fnv1a32, splitmix32, streamSeedU32, xoshiro128ss } from './rng.ts';
export type { BallOutcome, BallOutcomeKind, BallState, LaunchParams, Trajectory, TrajectorySample } from './physics.ts';
export {
  BALL_RADIUS_MM,
  BallSimulator,
  MAX_SPEED_Q,
  PHYS_CELL_MM,
  PHYS_DT_S,
  PHYS_MAX_SPEED_MM_S,
  PHYS_MAX_STEPS,
} from './physics.ts';
/** 決定論ゴールデン（P1-T5: 固定 1,000 LaunchParams のハッシュと符号化）。 */
export {
  GOLDEN_LAUNCH_COUNT,
  GOLDEN_OUTCOMES_HASH,
  encodeOutcomes,
  goldenBoard,
  goldenDirs,
  goldenLaunchParams,
  hashOutcomes,
} from './determinism.ts';
export type { AtlasEntry, AtlasHeader, AtlasVerifyResult } from './atlas.ts';
export {
  ATLAS_BUCKETS_PER_DIR,
  ATLAS_ENTRY_BYTES,
  ATLAS_ENTRY_COUNT,
  ATLAS_HEADER_BYTES,
  ATLAS_KIND_ATTACKER,
  ATLAS_KIND_LOST,
  ATLAS_KIND_OUT,
  ATLAS_KIND_START1,
  ATLAS_KIND_START2,
  ATLAS_KIND_V,
  ATLAS_MAGIC,
  ATLAS_TOTAL_BYTES,
  ATLAS_VERIFY_PREFIX,
  ATLAS_VERSION,
  atlasBucketForSpeedQ,
  atlasHashEquals,
  atlasKeyForBall,
  atlasKeyForParams,
  canonicalParamsForKey,
  decodeAtlasEntry,
  decodeAtlasFlightMs,
  decodeAtlasHeader,
  decodeAtlasKind,
  encodeAtlas,
  encodeAtlasFlightMs,
  encodeAtlasKind,
  launchParamsForBall,
  verifyAtlas,
} from './atlas.ts';
export type {
  Board,
  BoardLaunch,
  BoardPin,
  BoardSegment,
  BoardSensor,
  BoardYakumono,
  SensorKind,
} from './board.ts';
export type {
  HoldColor,
  HoldColorWeight,
  HoldTableColor,
  JackpotBranch,
  JackpotKind,
  JackpotNext,
  LotteryModeId,
  MachineMode,
  MachineSpec,
  MachineTier,
  PatternTable,
  SpinPattern,
} from './machine.ts';
export type { HoldEntry, LotteryHoldColor, LotteryMode } from './lottery.ts';
export {
  LOTTERY_HOLD_COLORS,
  LOTTERY_MODES,
  drawBonusHold,
  drawGrantHold,
  drawHold,
  hesoPayoutBalls,
  holdColorTable,
  holdColorWeights,
  holdHot,
  holdUnit,
  jackpotBonusRounds,
  jackpotPayoutBalls,
  jackpotTotalRounds,
  modeOf,
  splitWeights,
} from './lottery.ts';
export type { AcquireResult } from './hold-queue.ts';
export { HoldQueue, acquireHold } from './hold-queue.ts';
export type { ActiveJackpot, ActiveSpin, SimTime, SpinEvent, SpinSnapshot } from './spin.ts';
export { SpinMachine, jackpotBaseDurationMs, jackpotDurationMs, spinDurationMs } from './spin.ts';
export type { EconomyPort } from './economy.ts';
export { StubEconomy } from './economy.ts';
export type {
  AchievementRecord,
  AchievementsView,
  EngineAchievementMetrics,
  IdleEconomySnapshot,
  IdleYakumonoView,
  ShopCloseView,
  ShopUpgradeId,
  ShopUpgradeView,
  ShopView,
  ShopYakumonoView,
} from './economy-state.ts';
export { ECONOMY_BUY_TARGETS, IdleEconomy } from './economy-state.ts';
export type { Amount } from './economy-math.ts';
export {
  AMOUNT_MAX,
  CBRT_ITERATIONS,
  addAmount,
  awakenMedalCost,
  ballPoints,
  buildGrowthTable,
  buildPow115Table,
  cbrt40,
  closeGain,
  effectivePeriodS,
  growthPow,
  milestoneCount,
  pow115,
  shotUnit,
  streakMult,
  yakumonoBulkPrice,
  yakumonoPrice,
} from './economy-math.ts';
export type {
  AchievementDef,
  AchievementMetric,
  EconomyAchievements,
  EconomyAwaken,
  EconomyClaims,
  EconomyClose,
  EconomyFactors,
  EconomyMilestones,
  EconomyNotice,
  EconomyPachinko,
  EconomyProdRef,
  EconomySpec,
  EconomyUpgrades,
  EconomyYakumono,
  EconomyYakumonoId,
} from './economy-config.ts';
export {
  ACHIEVEMENT_METRICS,
  ECONOMY_YAKUMONO_IDS,
  parseEconomy,
  parseEconomyText,
} from './economy-config.ts';
export type {
  TreeEffect,
  TreeKeepTarget,
  TreeNodeSpec,
  TreeParseContext,
  TreeSpec,
} from './tree-config.ts';
export {
  EMPTY_TREE,
  TREE_KEEP_TARGETS,
  TREE_TIERS,
  parseTree,
  treeUnknownMachines,
} from './tree-config.ts';
export type {
  TreeBuyReason,
  TreeNodeState,
  TreeNodeView,
  TreeRecord,
  TreeTotals,
  TreeView,
} from './tree-state.ts';
export { treeClosePoints, treeRunBonus } from './tree-state.ts';
export type {
  Action,
  ActiveNotice,
  AwayReplay,
  AwaySpinCandidate,
  AwaySummary,
  AwayTrackerSnapshot,
  CloseRecord,
  EngineConfig,
  EngineSnapshot,
  Grant,
  HallProjection,
  HotHint,
  JackpotView,
  NoticeEffect,
  NoticeView,
  PendingSensor,
  SimEvent as EngineSimEvent,
  SpinView,
  Totals,
  YakumonoView,
} from './engine.ts';
export { BONUS_SERIAL_BASE, Engine, FIRE_INTERVAL_MS, GRANT_HOLD_SERIAL_BASE, RESERVE_SERIAL_BASE, projectSnapshot } from './engine.ts';
export {
  HOLD_COLORS,
  HOLD_TABLE_COLORS,
  JACKPOT_KINDS,
  JACKPOT_NEXTS,
  LOTTERY_MODE_IDS,
  MACHINE_TIERS,
  defaultNextForKind,
  jackpotThresholdU32,
  parseMachine,
  parseMachineText,
  parsePatterns,
  parsePatternsText,
} from './machine.ts';
export {
  LAUNCH_DIR_COUNT,
  LAUNCH_DIR_TABLE_ID,
  MAX_LAUNCH_SPEED_MM_S,
  SENSOR_KINDS,
  bytesToHex,
  canonicalBoardJson,
  hashBoard,
  parseBoard,
  parseBoardText,
  parseLaunchDirs,
} from './board.ts';
