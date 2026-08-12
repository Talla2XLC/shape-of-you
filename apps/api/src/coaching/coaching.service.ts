import { Inject, Injectable } from "@nestjs/common";

import type {
  CoachingRecommendation,
  CoachingRecommendationHistory,
  CoachingRecommendationList,
  CreateCoachingRecommendationDecision,
  CreateTrainingAdjustmentRecommendation,
  ListCoachingRecommendationsQuery
} from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import { COACHING_STORE, PERSON_CONTEXT } from "../application/tokens.js";
import { NotFoundError } from "../domain/errors.js";
import type {
  CoachingStore,
  CreatedCoachingDecision,
  CreatedCoachingRecommendation
} from "../storage/coaching-repository.js";

/** Application boundary for Coaching recommendations and explicit decisions. */
@Injectable()
export class CoachingService {
  public constructor(
    @Inject(COACHING_STORE) private readonly store: CoachingStore,
    @Inject(PERSON_CONTEXT) private readonly personContext: PersonContext
  ) {}

  public createTrainingAdjustment(
    input: CreateTrainingAdjustmentRecommendation
  ): Promise<CreatedCoachingRecommendation> {
    return this.store.createTrainingAdjustment(this.personContext.getPersonId(), input);
  }

  public decide(
    id: string,
    input: CreateCoachingRecommendationDecision
  ): Promise<CreatedCoachingDecision> {
    return this.store.decide(this.personContext.getPersonId(), id, input);
  }

  public async find(id: string): Promise<CoachingRecommendation> {
    const recommendation = await this.store.find(this.personContext.getPersonId(), id);
    if (!recommendation) throw new NotFoundError("Coaching recommendation was not found");
    return recommendation;
  }

  public list(query: ListCoachingRecommendationsQuery): Promise<CoachingRecommendationList> {
    return this.store.list(this.personContext.getPersonId(), query);
  }

  /** Reads all recommendations for a local date for a coordinating projection. */
  public listForLocalDate(localDate: string, timezone: string): Promise<readonly CoachingRecommendation[]> {
    return this.store.listForLocalDate(this.personContext.getPersonId(), localDate, timezone);
  }

  public async history(id: string): Promise<CoachingRecommendationHistory> {
    const history = await this.store.history(this.personContext.getPersonId(), id);
    if (!history) throw new NotFoundError("Coaching recommendation was not found");
    return history;
  }
}
