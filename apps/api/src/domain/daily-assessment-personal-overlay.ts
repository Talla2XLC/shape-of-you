import type {
  DailyAssessmentStatus,
  DailyNextAction
} from "@shape-of-you/contracts";

/** Normalized personal signals consumed by the conservative status overlay. */
export interface PersonalOverlaySignals {
  readonly hardStop: boolean;
  readonly eligibleBeforeStability: boolean;
  readonly markedPersonalSignalCount: number;
  readonly adversePersonalSignalCount: number;
  readonly persistentPersonalSignalCount: number;
  readonly adverseCenterPresent: boolean;
}

/** Result of applying personal evidence without weakening the v1 decision. */
export interface PersonalOverlayResult {
  readonly status: DailyAssessmentStatus;
  readonly action: DailyNextAction;
  readonly changed: boolean;
}

function recoveryAction(text: string): DailyNextAction {
  return { type: "recovery_first", text, trainingProgramVersionId: null };
}

/**
 * Applies the sole authoritative personal-baseline decision rule to a v1 base.
 * The overlay can only preserve or strengthen the base outcome.
 */
export function applyConservativePersonalOverlay(
  baseStatus: DailyAssessmentStatus,
  baseAction: DailyNextAction,
  signals: PersonalOverlaySignals
): PersonalOverlayResult {
  if (baseStatus === "insufficient_data") {
    if (!signals.hardStop) return { status: baseStatus, action: baseAction, changed: false };
    return {
      status: "recovery_priority",
      action: recoveryAction("Сегодня не повышай нагрузку: доступные данные содержат явный сигнал остановиться и поставить восстановление первым действием."),
      changed: true
    };
  }
  if (
    signals.hardStop ||
    (signals.eligibleBeforeStability && signals.markedPersonalSignalCount >= 2)
  ) {
    if (baseStatus === "recovery_priority") {
      return { status: baseStatus, action: baseAction, changed: false };
    }
    return {
      status: "recovery_priority",
      action: recoveryAction("Сегодня не повышай нагрузку: несколько показателей заметно отклонились от твоего обычного уровня. Поставь восстановление первым действием."),
      changed: true
    };
  }
  if (
    baseStatus === "ready" &&
    (
      signals.adverseCenterPresent ||
      signals.persistentPersonalSignalCount > 0 ||
      signals.adversePersonalSignalCount >= 2
    )
  ) {
    return {
      status: "caution",
      action: recoveryAction("Сегодня сохрани консервативную нагрузку без прогрессии: доступные показатели отклонились от твоего обычного уровня."),
      changed: true
    };
  }
  return { status: baseStatus, action: baseAction, changed: false };
}
