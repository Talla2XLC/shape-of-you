import { Inject, Injectable } from "@nestjs/common";

import type {
  CorrectRecoveryObservation,
  CreateRecoveryAssessment,
  CreateRecoveryConnection,
  CreateRecoveryObservation,
  GrantRecoveryConsent,
  ListRecoveryObservationsQuery,
  RecoveryAssessment,
  RecoveryAssessmentList,
  RecoveryConnection,
  RecoveryConnectionList,
  RecoveryConsent,
  RecoveryErasureRequest,
  RecoveryObservation,
  RecoveryObservationHistory,
  RecoveryObservationList,
  RevokeRecoveryConsent
} from "@shape-of-you/contracts";

import type { PersonContext } from "../application/person-context.js";
import { PERSON_CONTEXT, RECOVERY_STORE } from "../application/tokens.js";
import { NotFoundError } from "../domain/errors.js";
import type {
  CreatedRecoveryAssessment,
  CreatedRecoveryObservation,
  RecoveryStore
} from "../storage/recovery-repository.js";

/** Application boundary for Recovery observations, consent and assessments. */
@Injectable()
export class RecoveryService {
  public constructor(
    @Inject(RECOVERY_STORE) private readonly store: RecoveryStore,
    @Inject(PERSON_CONTEXT) private readonly personContext: PersonContext
  ) {}

  public createConnection(input: CreateRecoveryConnection): Promise<RecoveryConnection> {
    return this.store.createConnection(this.personContext.getPersonId(), input);
  }

  public listConnections(): Promise<RecoveryConnectionList> {
    return this.store.listConnections(this.personContext.getPersonId());
  }

  public grantConsent(connectionId: string, input: GrantRecoveryConsent): Promise<RecoveryConsent> {
    return this.store.grantConsent(this.personContext.getPersonId(), connectionId, input);
  }

  public revokeConsent(consentId: string, input: RevokeRecoveryConsent): Promise<RecoveryConsent> {
    return this.store.revokeConsent(this.personContext.getPersonId(), consentId, input);
  }

  public createObservation(input: CreateRecoveryObservation): Promise<CreatedRecoveryObservation> {
    return this.store.createObservation(this.personContext.getPersonId(), input);
  }

  public correctObservation(id: string, input: CorrectRecoveryObservation): Promise<CreatedRecoveryObservation> {
    return this.store.correctObservation(this.personContext.getPersonId(), id, input);
  }

  public async findObservation(id: string): Promise<RecoveryObservation> {
    const observation = await this.store.findObservation(this.personContext.getPersonId(), id);
    if (!observation) throw new NotFoundError("Recovery observation was not found");
    return observation;
  }

  public listObservations(query: ListRecoveryObservationsQuery): Promise<RecoveryObservationList> {
    return this.store.listObservations(this.personContext.getPersonId(), query);
  }

  /** Reads all current observations for a single local date for a coordinating projection. */
  public listObservationsForLocalDate(localDate: string): Promise<readonly RecoveryObservation[]> {
    return this.store.listObservationsForLocalDate(this.personContext.getPersonId(), localDate);
  }

  /** Reads current recovery observations across an inclusive Person-local date range. */
  public listObservationsForLocalDateRange(from: string, to: string): Promise<readonly RecoveryObservation[]> {
    return this.store.listObservationsForLocalDateRange(this.personContext.getPersonId(), from, to);
  }

  public async observationHistory(id: string): Promise<RecoveryObservationHistory> {
    const history = await this.store.observationHistory(this.personContext.getPersonId(), id);
    if (!history) throw new NotFoundError("Recovery observation was not found");
    return history;
  }

  public createAssessment(input: CreateRecoveryAssessment): Promise<CreatedRecoveryAssessment> {
    return this.store.createAssessment(this.personContext.getPersonId(), input);
  }

  public async findAssessment(id: string): Promise<RecoveryAssessment> {
    const assessment = await this.store.findAssessment(this.personContext.getPersonId(), id);
    if (!assessment) throw new NotFoundError("Recovery assessment was not found");
    return assessment;
  }

  public listAssessments(limit = 50): Promise<RecoveryAssessmentList> {
    return this.store.listAssessments(this.personContext.getPersonId(), limit);
  }

  public async findErasureRequest(id: string): Promise<RecoveryErasureRequest> {
    const request = await this.store.findErasureRequest(
      this.personContext.getPersonId(),
      id
    );
    if (!request) throw new NotFoundError("Recovery erasure request was not found");
    return request;
  }

  /** Reads all assessments for a single local date for a coordinating projection. */
  public listAssessmentsForLocalDate(localDate: string): Promise<readonly RecoveryAssessment[]> {
    return this.store.listAssessmentsForLocalDate(this.personContext.getPersonId(), localDate);
  }

  /** Reads recovery assessments across an inclusive Person-local date range. */
  public listAssessmentsForLocalDateRange(from: string, to: string): Promise<readonly RecoveryAssessment[]> {
    return this.store.listAssessmentsForLocalDateRange(this.personContext.getPersonId(), from, to);
  }
}
