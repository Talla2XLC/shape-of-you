import { Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import type { BodyCompositionObservation, ConnectedDailyFitnessSummary, ConnectedNutritionDay, ConnectedProviderDateQuery } from "@shape-of-you/contracts";

import { CONNECTED_PROVIDER_DATA_STORE, DAILY_ASSESSMENT_STORE, PERSON_CONTEXT } from "../application/tokens.js";
import type { PersonContext } from "../application/person-context.js";
import { assertIanaTimezone, assertLocalDate } from "../domain/date-context.js";
import { DomainValidationError } from "../domain/errors.js";
import type { DailyAssessmentStore } from "../storage/daily-assessment-repository.js";
import type { ConnectedProviderRepository } from "../storage/connected-provider-repository.js";

/** Composes typed imported facts without merging them into manual ledgers or owning import policy. */
@Injectable()
export class ConnectedProviderDataService {
  public constructor(
    @Inject(PERSON_CONTEXT) private readonly person: PersonContext,
    @Inject(DAILY_ASSESSMENT_STORE) private readonly preferences: DailyAssessmentStore,
    @Optional() @Inject(CONNECTED_PROVIDER_DATA_STORE) private readonly store: ConnectedProviderRepository | null = null
  ) {}

  /** Indicates whether durable storage is configured; an absent backend is never reported as an empty history. */
  public isConfigured(): boolean { return this.store !== null; }

  /** Reads a bounded date range of Training-owned daily fitness facts. */
  public async fitness(query: ConnectedProviderDateQuery = {}): Promise<{ items: ConnectedDailyFitnessSummary[] }> {
    const store = this.requiredStore();
    const to = query.toDate ?? query.fromDate ?? await this.today();
    const from = query.fromDate ?? to;
    assertLocalDate(from); assertLocalDate(to);
    const days = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
    if (days < 0 || days > 365) throw new DomainValidationError("Connected fitness date range must cover at most 366 days");
    return { items: [...await store.readFitnessDays(this.person.getPersonId(), from, to)] };
  }

  /** Reads external Nutrition totals separately from recorded Meals; null means no imported fact. */
  public async nutrition(localDate: string): Promise<{ item: ConnectedNutritionDay | null }> {
    assertLocalDate(localDate);
    return { item: await this.requiredStore().readNutritionDay(this.person.getPersonId(), localDate) };
  }

  /** Lists Physical State composition observations with exact ownership and bounded output. */
  public async bodyComposition(query: ConnectedProviderDateQuery = {}): Promise<{ items: BodyCompositionObservation[] }> {
    if (query.fromDate) assertLocalDate(query.fromDate);
    if (query.toDate) assertLocalDate(query.toDate);
    if (query.fromDate && query.toDate && query.fromDate > query.toDate) throw new DomainValidationError("Invalid body composition date range");
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)) throw new DomainValidationError("Body composition limit must be between 1 and 100");
    return { items: [...await this.requiredStore().listBodyComposition(this.person.getPersonId(), query)] };
  }

  private requiredStore(): ConnectedProviderRepository {
    if (!this.store) throw new ServiceUnavailableException("Connected provider data storage is unavailable");
    return this.store;
  }

  private async today(): Promise<string> {
    const { timezone } = await this.preferences.getPreferences(this.person.getPersonId());
    if (timezone === null) throw new DomainValidationError("Person timezone is required");
    assertIanaTimezone(timezone);
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}
