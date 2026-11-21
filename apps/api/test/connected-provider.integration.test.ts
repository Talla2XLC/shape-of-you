import { buildApp } from "../src/app.js";
import { DailyAssessmentService } from "../src/coaching/daily-assessment.service.js";
import { DailyAssessmentRepository } from "../src/storage/daily-assessment-repository.js";
import { CoachingRepository } from "../src/storage/coaching-repository.js";
import { CurrentRecoveryContextService } from "../src/coaching/current-recovery-context.service.js";
import { RecoveryService } from "../src/recovery/recovery.service.js";
import type { DailyAssessmentStore } from "../src/storage/daily-assessment-repository.js";
import { WeightMeasurementRepository } from "../src/storage/weight-measurement-repository.js";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@shape-of-you/config";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { IntegrationRepository } from "../src/storage/integration-repository.js";
import { ConnectedProviderRepository } from "../src/storage/connected-provider-repository.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";
import { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";
import type { CreateRecoveryObservation, GarminPersonalConnection, ProviderConnectedDayRecord } from "@shape-of-you/contracts";
import { trackPoolShutdown } from "./support/pool-shutdown.js";

let closePool: (() => Promise<void>) | undefined;
let db: DatabaseContext;
let container: StartedPostgreSqlContainer | undefined;
const cipher = new ConnectionCredentialCipher("synthetic", new Map([["synthetic", randomBytes(32)]]));
beforeAll(async () => {
    process.env.PERSON_CONTEXT_MODE = "synthetic";
    process.env.SYNTHETIC_PERSON_ID = randomUUID();
    let url = process.env.TASK0182_TEST_DATABASE_URL;
    if (url) {
        const parsed = new URL(url);
        if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55485" || !parsed.pathname.startsWith("/soy_task0182_"))
            throw Error("Only isolated TASK0182 PG is permitted");
    }
    else {
        container = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("soy_task0182_connected").start();
        url = container.getConnectionUri();
    }
    await runMigrations(url);
    await runMigrations(url);
    db = createDatabase(loadConfig({ DATABASE_URL: url, NODE_ENV: "test", PERSON_CONTEXT_MODE: "synthetic", SYNTHETIC_PERSON_ID: randomUUID() }));
    closePool = trackPoolShutdown(db.pool);
});
afterAll(async () => {
    await closePool?.();
    await container?.stop();
});
async function fixture() {
    const personId = randomUUID(), id = randomUUID(), recoveryConnectionId = randomUUID(), consentId = randomUUID();
    await db.pool.query("insert into persons(id,kind,timezone) values($1,'synthetic','Europe/Moscow')", [personId]);
    const store = new IntegrationRepository<GarminPersonalConnection>(db, "garmin_personal");
    await store.activate({ id, personId, recoveryConnectionId, consentId, externalUserId: "synthetic", credential: cipher.encrypt("synthetic", `garmin_personal:${personId}:${id}`), authorizationStartedAt: new Date() });
    return { connection: { id, personId, consentId, providerKey: "garmin_personal" }, recoveryConnectionId, store, repo: new ConnectedProviderRepository(db) };
}
const day = (date = "2026-11-21"): ProviderConnectedDayRecord => ({ identity: date, localDate: date, timezone: "Europe/Moscow", fitness: { energyMovement: { restingExpenditureKcal: 1700, activeExpenditureKcal: 300, totalExpenditureKcal: 2000, movementDistanceMeters: 4000, floorsUp: 5, floorsDown: 4, moderateMinutes: 25, vigorousMinutes: 0 } }, nutrition: { intake: { consumedCaloriesKcal: 1800, proteinGrams: 100, fatGrams: 60, carbohydrateGrams: 200 } } });
const body = (identity = "sample") => ({ identity, localDate: "2026-11-21", timezone: "Europe/Moscow", measuredAt: "2026-11-21T08:00:00.000Z", weightKg: 75, composition: { bodyFatPercent: 20, bodyWaterPercent: 55, muscleMassKg: 50, boneMassKg: 3, bmi: 24 } });
describe("typed connected provider domains", () => {
    it("rejects a numeric provider exercise load without its explicit basis at the SQL boundary",async()=>{
        const f=await fixture();
        const insert=(load:number|null,basis:string|null)=>db.pool.query("insert into integration_activity_facts(connection_id,person_id,provider_identity,normalized_checksum,occurred_at,local_date,timezone,name,duration_seconds,source_provider,garmin_attributed,provider_exercise_load,provider_exercise_load_basis) values($1,$2,$3,'synthetic',now(),'2026-11-21','Europe/Moscow','Synthetic activity',60,'garmin_personal',true,$4,$5)",[f.connection.id,f.connection.personId,randomUUID(),load,basis]);
        await expect(insert(10,null)).rejects.toThrow();
        await expect(insert(null,"garmin_activity_training_load_v1")).rejects.toThrow();
        await expect(insert(10,"garmin_activity_training_load_v1")).resolves.toBeDefined();
        await expect(insert(null,null)).resolves.toBeDefined();
        for(const [column,value]of [["aerobic_training_effect",6],["anaerobic_training_effect",6],["training_stress_score",10001],["provider_exercise_load",100001],["average_power_watts",10001],["intensity_factor",11],["body_battery_delta",-101]] as const){
            await expect(db.pool.query(`update integration_activity_facts set ${column}=$1 where connection_id=$2`,[value,f.connection.id])).rejects.toThrow();
        }
    });

    it("imports date-only provider weight without inventing midnight and remains idempotent",async()=>{
        const f=await fixture();const measurement={...body("date:2026-11-21"),measuredAt:null,composition:null,weightKg:80.1234};
        expect(await f.repo.importBodyMeasurement(f.connection,measurement)).toBe("created");
        expect(await f.repo.importBodyMeasurement(f.connection,measurement)).toBe("unchanged");
        const stored=(await new WeightMeasurementRepository(db).listForLocalDate(f.connection.personId,"2026-11-21"))[0]!;
        expect(stored).toMatchObject({measuredAt:null,temporalPrecision:"local_date",localDate:"2026-11-21",timezone:"Europe/Moscow",weightKg:80.123});
        expect(await f.repo.listBodyComposition(f.connection.personId)).toEqual([]);
    });

    it("canonicalizes provider kilograms once so extra wire precision cannot create endless weight corrections",async()=>{
        const f=await fixture();const measurement={...body(),weightKg:80.1234};
        expect(await f.repo.importBodyMeasurement(f.connection,measurement)).toBe("created");
        const first=(await f.repo.listBodyComposition(f.connection.personId))[0]!;
        expect(await f.repo.importBodyMeasurement(f.connection,measurement)).toBe("unchanged");
        const repeated=(await f.repo.listBodyComposition(f.connection.personId))[0]!;
        expect(repeated.id).toBe(first.id);expect(repeated.weightMeasurementId).toBe(first.weightMeasurementId);
        expect((await db.pool.query("select weight_kg from weight_measurements where integration_connection_id=$1",[f.connection.id])).rows).toEqual([{weight_kg:"80.123"}]);
    });

    it("removes real cached weight-derived DailyAssessment snapshots atomically when source erasure is accepted",async()=>{
        const f=await fixture();const now=new Date();const localDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
        await f.repo.importBodyMeasurement(f.connection,{...body(),measuredAt:now.toISOString(),localDate});
        const app=await buildApp({database:db,config:loadConfig({DATABASE_URL:process.env.TASK0182_TEST_DATABASE_URL??container!.getConnectionUri(),NODE_ENV:"test",PERSON_CONTEXT_MODE:"synthetic",SYNTHETIC_PERSON_ID:f.connection.personId})});
        try{
            const service=app.get(DailyAssessmentService);await service.updatePreferences({timezone:"Europe/Moscow"});
            const assessment=await service.read();if(assessment.state!=="available")throw Error("Expected real synthetic DailyAssessment snapshot");
            const snapshots=new DailyAssessmentRepository(db);const stored=await snapshots.getCompletionSnapshot(f.connection.personId,assessment.snapshotId);
            expect(stored.usedFacts.summary.latestWeightKg).toBe(75);expect(stored.usedFacts.weightMeasurementIds).toHaveLength(1);
            await new RecoveryRepository(db).requestErasure(f.connection.personId,f.recoveryConnectionId,randomUUID(),"user_request",randomUUID());
            // Physical deletion has not run; source weight remains quarantined, cached health payload is already gone.
            expect((await db.pool.query("select count(*)::int as n from weight_measurements where integration_connection_id=$1",[f.connection.id])).rows[0].n).toBe(1);
            await expect(snapshots.getCompletionSnapshot(f.connection.personId,assessment.snapshotId)).rejects.toThrow("not found");
            expect(await snapshots.findLatestCompletionSnapshotForLocalDate(f.connection.personId,localDate)).toBeNull();
            expect(await new CoachingRepository(db).find(f.connection.personId,assessment.snapshotId)).toBeNull();
            expect((await db.pool.query("select count(*)::int as n from coaching_recommendations where id=$1",[assessment.snapshotId])).rows[0].n).toBe(0);
        }finally{await app.close();}
    });

    it("rejects canonical percent, age, VO2, duration and body-mass bounds at both repository and SQL boundaries",async()=>{
        const f=await fixture();
        for(const bad of [{...body().composition,bodyFatPercent:150},{...body().composition,bodyWaterPercent:150},{...body().composition,muscleMassKg:701},{...body().composition,bmi:201}])await expect(f.repo.importBodyMeasurement(f.connection,{...body(),composition:bad})).rejects.toThrow();
        await expect(f.repo.importFitnessDay(f.connection,{...day(),fitness:{fitnessAge:{fitnessAgeYears:151,achievableFitnessAgeYears:30,fitnessAgeAsOf:null,fitnessAgeComputedAt:null}}})).rejects.toThrow();
        await expect(f.repo.importFitnessDay(f.connection,{...day(),fitness:{vo2Max:{vo2Max:151,vo2MaxCycling:null,vo2MaxRowing:null}}})).rejects.toThrow();
        await expect(f.repo.importFitnessDay(f.connection,{...day(),fitness:{energyMovement:{...day().fitness!.energyMovement!,moderateMinutes:1441}}})).rejects.toThrow();
        await f.repo.importFitnessDay(f.connection,day());await f.repo.importBodyMeasurement(f.connection,body());
        for(const column of ["fitness_age_years","vo2_max","moderate_minutes"]){const invalid=column==="moderate_minutes"?1441:151;await expect(db.pool.query(`update connected_daily_fitness set ${column}=$1 where person_id=$2`,[invalid,f.connection.personId])).rejects.toThrow();}
        for(const column of ["body_fat_percent","body_water_percent","muscle_mass_kg","bmi"]){const invalid=column==="muscle_mass_kg"?701:column==="bmi"?201:101;await expect(db.pool.query(`update body_composition_observations set ${column}=$1 where person_id=$2`,[invalid,f.connection.personId])).rejects.toThrow();}
    });

    it("confirms Garmin HRV and sleep score only through an actual completed receipt in the current generation",async()=>{
        const f=await fixture();const recovery=new RecoveryRepository(db);const receipt=await f.store.recordInbox(f.connection.id,f.connection.consentId,"wellness","2026-11-21","synthetic-confirmed",{localDate:"2026-11-21"});
        if(receipt.state!=="process")throw Error("Expected new synthetic receipt");
        for(const metric of ["hrv_rmssd","sleep_score"] as const){
            const saved=await recovery.createObservation(f.connection.personId,{kind:"metric",observedFrom:null,observedUntil:null,localDate:"2026-11-21",temporalPrecision:"local_date",timezone:"Europe/Moscow",quality:"reliable",connectionId:f.recoveryConnectionId,consentId:f.connection.consentId,dedupeKey:randomUUID(),sourceReference:{channel:"account",externalSystem:"garmin_personal_wellness",externalRecordId:randomUUID(),occurredAt:null},detail:{type:"metric",metric,value:metric==="hrv_rmssd"?40:80,unit:metric==="hrv_rmssd"?"ms":"score"}});
            await f.store.linkRecoveryFact(f.connection.id,f.connection.consentId,"2026-11-21",receipt.receiptId,metric,"synthetic-metric",saved.observation.id);
        }
        const before=await f.store.connectedRecoveryDelivery(f.connection.personId,"2026-11-21");
        expect(before?.metricDelivery.filter(x=>["hrv_rmssd","sleep_score"].includes(x.metric)).every(x=>x.state!=="confirmed_present")).toBe(true);
        await f.store.completeInbox(f.connection.id,f.connection.consentId,receipt.receiptId);
        const person={getPersonId:()=>f.connection.personId};
        const service=new CurrentRecoveryContextService(person,{getPreferences:async()=>({timezone:"Europe/Moscow"})} as unknown as DailyAssessmentStore,null,new RecoveryService(recovery,person),f.store);
        const result=await service.read(new Date("2026-11-21T10:00:00.000Z"));
        expect(result).toMatchObject({state:"available",metricDelivery:expect.arrayContaining([{metric:"hrv_rmssd",state:"confirmed_present",periodState:null,asOf:null},{metric:"sleep_score",state:"confirmed_present",periodState:null,asOf:null}])});
        const next=randomUUID();await f.store.activate({id:f.connection.id,personId:f.connection.personId,recoveryConnectionId:f.recoveryConnectionId,consentId:next,externalUserId:"synthetic",credential:cipher.encrypt("next",`garmin_personal:${f.connection.personId}:${f.connection.id}`),authorizationStartedAt:new Date()});
        const rotated=await f.store.connectedRecoveryDelivery(f.connection.personId,"2026-11-21");
        expect(rotated?.metricDelivery.filter(x=>["hrv_rmssd","sleep_score"].includes(x.metric)).every(x=>x.state!=="confirmed_present")).toBe(true);
    });
    it("retains connected history on ordinary disconnect while only accepted erasure suppresses reads",async()=>{
        const f=await fixture();await f.repo.importFitnessDay(f.connection,day());await f.repo.importNutritionDay(f.connection,day());await f.repo.importBodyMeasurement(f.connection,body());
        await f.store.beginDisconnect(f.connection.personId,"Synthetic ordinary disconnect");
        expect(await f.repo.readFitnessDays(f.connection.personId,"2026-11-21","2026-11-21")).toHaveLength(1);
        expect(await f.repo.readNutritionDay(f.connection.personId,"2026-11-21")).not.toBeNull();expect(await f.repo.listBodyComposition(f.connection.personId)).toHaveLength(1);
        expect((await new WeightMeasurementRepository(db).list(f.connection.personId,100)).items).toHaveLength(1);
    });

    for(const eraseTarget of [false,true])it(`erasure preserves correction denial across alternating account chains (${eraseTarget?"target":"source"} first)`,async()=>{
        const f=await fixture();const recovery=new RecoveryRepository(db);
        const provider=await db.pool.query("insert into recovery_providers(key,name) values('synthetic_other_account','Synthetic account') on conflict(key) do update set name=excluded.name returning id");
        const sourceConnectionId=randomUUID(),sourceConsentId=randomUUID();
        await db.pool.query("insert into recovery_connections(id,person_id,provider_id,dedupe_key) values($1,$2,$3,$4)",[sourceConnectionId,f.connection.personId,provider.rows[0].id,randomUUID()]);
        await db.pool.query("insert into recovery_consents(id,person_id,connection_id,purpose,retention_mode,integration_import_scopes) values($1,$2,$3,'Synthetic source','indefinite',ARRAY['recovery','training'])",[sourceConsentId,f.connection.personId,sourceConnectionId]);
        await db.pool.query("insert into recovery_consent_kinds(consent_id,kind) values($1,'metric')",[sourceConsentId]);
        const command=(target:boolean):CreateRecoveryObservation=>({kind:"metric",observedFrom:null,observedUntil:null,localDate:"2026-11-21",temporalPrecision:"local_date",timezone:"Europe/Moscow",quality:"reliable",connectionId:target?f.recoveryConnectionId:sourceConnectionId,consentId:target?f.connection.consentId:sourceConsentId,dedupeKey:randomUUID(),sourceReference:{channel:"account",externalSystem:target?"garmin_personal_wellness":"synthetic_other_account",externalRecordId:randomUUID(),occurredAt:null},detail:{type:"metric",metric:"body_battery",unit:"score",value:50}});
        const a=(await recovery.createObservation(f.connection.personId,command(false))).observation;
        const b=(await recovery.correctObservation(f.connection.personId,a.id,{...command(true),reason:"approved_provider_transfer"})).observation;
        const c=(await recovery.correctObservation(f.connection.personId,b.id,{...command(false),reason:"synthetic_alternating_chain"})).observation;
        const d=(await recovery.correctObservation(f.connection.personId,c.id,{...command(true),reason:"synthetic_alternating_chain"})).observation;
        const manual=(await recovery.createObservation(f.connection.personId,{...command(false),connectionId:null,consentId:null,sourceReference:{channel:"manual",externalSystem:null,externalRecordId:null,occurredAt:null}})).observation;
        const erased=eraseTarget?f.recoveryConnectionId:sourceConnectionId;
        const marker={id:randomUUID(),personId:f.connection.personId,connectionId:erased,reason:"user_request" as const,requestedAt:new Date().toISOString()};
        await recovery.replayErasureMarker(marker);await recovery.replayErasureMarker(marker);
        expect(await recovery.findObservation(f.connection.personId,manual.id)).not.toBeNull();
        if(eraseTarget){expect(await recovery.findObservation(f.connection.personId,a.id)).toBeNull();expect(await recovery.findObservation(f.connection.personId,c.id)).toBeNull();}
        else{expect(await recovery.findObservation(f.connection.personId,b.id)).toBeNull();expect(await recovery.findObservation(f.connection.personId,d.id)).toMatchObject({supersedesId:null});}
        const remaining=eraseTarget?sourceConnectionId:f.recoveryConnectionId;
        await recovery.replayErasureMarker({...marker,id:randomUUID(),connectionId:remaining});
        expect(await recovery.findObservation(f.connection.personId,manual.id)).not.toBeNull();
    });

    it("preserves provider as-of/computed provenance through partial bundles without inventing a new age measurement date",async()=>{
        const f=await fixture();
        await f.repo.importFitnessDay(f.connection,{...day(),fitness:{fitnessAge:{fitnessAgeYears:35,achievableFitnessAgeYears:30,fitnessAgeAsOf:"2025-01-02",fitnessAgeComputedAt:"2025-01-02T15:00:00.000Z"}}});
        await f.repo.importFitnessDay(f.connection,day());
        expect(await f.repo.readFitnessDays(f.connection.personId,"2026-11-21","2026-11-21")).toMatchObject([{localDate:"2026-11-21",values:{fitnessAgeYears:35,fitnessAgeAsOf:"2025-01-02",fitnessAgeComputedAt:"2025-01-02T15:00:00.000Z",totalExpenditureKcal:2000}}]);
    });

    it("persists typed Recovery stress, enriched main sleep and separately identified naps with SQL unit guards", async()=>{
        const f=await fixture();const recovery=new RecoveryRepository(db);
        const base={observedFrom:null,observedUntil:null,localDate:"2026-11-21",temporalPrecision:"local_date" as const,timezone:"Europe/Moscow",quality:"reliable" as const,connectionId:f.recoveryConnectionId,consentId:f.connection.consentId};
        const source=()=>({channel:"account" as const,externalSystem:"garmin_personal",externalRecordId:randomUUID(),occurredAt:null});
        const sleep:CreateRecoveryObservation={...base,kind:"sleep",dedupeKey:randomUUID(),sourceReference:source(),detail:{type:"sleep",totalSleepMinutes:420,sleepQuality:null,awakeSleepMinutes:20,sleepNeedMinutes:480,sleepNeedBaselineMinutes:460,nextSleepNeedMinutes:470,nextSleepNeedBaselineMinutes:460,breathingDisruptionSeverity:"LOW",sleepKind:"main_sleep"}};
        const night=await recovery.createObservation(f.connection.personId,sleep);
        expect(night.observation.detail).toMatchObject({sleepKind:"main_sleep",sleepNeedMinutes:480,awakeSleepMinutes:20,breathingDisruptionSeverity:"LOW"});
        const nap=await recovery.createObservation(f.connection.personId,{...sleep,observedFrom:"2026-11-21T10:00:00.000Z",observedUntil:"2026-11-21T10:30:00.000Z",temporalPrecision:"instant",dedupeKey:randomUUID(),sourceReference:source(),detail:{type:"sleep",totalSleepMinutes:30,sleepQuality:null,sleepKind:"nap"}});
        expect(nap.observation.detail).toMatchObject({sleepKind:"nap",totalSleepMinutes:30});
        const stress=await recovery.createObservation(f.connection.personId,{...base,kind:"metric",dedupeKey:randomUUID(),sourceReference:source(),detail:{type:"metric",metric:"stress_high_minutes",value:25,unit:"minute"}});
        expect(stress.observation.detail).toMatchObject({metric:"stress_high_minutes",value:25,unit:"minute"});
        await expect(db.pool.query("update recovery_metric_details set unit='bpm' where observation_id=$1",[stress.observation.id])).rejects.toThrow();
        const stranger=await fixture();
        await f.repo.importFitnessDay(f.connection,day());
        await expect(db.pool.query("update connected_daily_fitness set person_id=$1 where person_id=$2",[stranger.connection.personId,f.connection.personId])).rejects.toThrow();
    });

    it("retains immutable legacy scope permissions while a fresh Garmin generation grants all four explicit purposes", async () => {
        const f = await fixture();
        const original = await db.pool.query("select integration_import_scopes,purpose from recovery_consents where id=$1", [f.connection.consentId]);
        expect(original.rows[0].integration_import_scopes).toEqual(["recovery", "training", "physical_state", "nutrition"]);
        expect(original.rows[0].purpose).toContain("Physical State and Nutrition");
        const next = randomUUID();
        await f.store.activate({ id: f.connection.id, personId: f.connection.personId, recoveryConnectionId: f.recoveryConnectionId, consentId: next, externalUserId: "synthetic", credential: cipher.encrypt("next", `garmin_personal:${f.connection.personId}:${f.connection.id}`), authorizationStartedAt: new Date() });
        expect(await f.repo.importFitnessDay(f.connection, day())).toBe("stopped");
        expect(await f.repo.importNutritionDay({ ...f.connection, consentId: next }, day())).toBe("created");
        expect((await db.pool.query("select integration_import_scopes,status from recovery_consents where id=$1", [f.connection.consentId])).rows[0]).toMatchObject({ integration_import_scopes: ["recovery", "training", "physical_state", "nutrition"], status: "revoked" });
    });
    it("publishes immutable logical-day successors, preserves omitted groups and clears only authoritative groups", async () => {
        const f = await fixture();
        expect(await f.repo.importFitnessDay(f.connection, day())).toBe("created");
        const record = { ...day(), fitness: { vo2Max: { vo2Max: 45, vo2MaxCycling: null, vo2MaxRowing: null } } };
        expect(await f.repo.importFitnessDay(f.connection, record)).toBe("corrected");
        expect(await f.repo.importFitnessDay(f.connection, record)).toBe("unchanged");
        expect(await f.repo.readFitnessDays(f.connection.personId, "2026-11-21", "2026-11-21")).toMatchObject([{ version: 2, values: { totalExpenditureKcal: 2000, vo2Max: 45 } }]);
        await f.repo.importFitnessDay(f.connection, { ...day(), fitness: { energyMovement: null } });
        expect(await f.repo.readFitnessDays(f.connection.personId, "2026-11-21", "2026-11-21")).toMatchObject([{ version: 3, values: { totalExpenditureKcal: null, vo2Max: 45 } }]);
    });
    it("keeps Nutrition intake separate from hydration, preserves measured zero and withdraws complete empty groups", async () => {
        const f = await fixture();
        await f.repo.importNutritionDay(f.connection, day());
        await f.repo.importNutritionDay(f.connection, { ...day(), nutrition: { hydration: { consumedFluidMl: 0 } } });
        expect(await f.repo.readNutritionDay(f.connection.personId, "2026-11-21")).toMatchObject({ version: 2, values: { proteinGrams: 100, consumedFluidMl: 0 } });
        await f.repo.importNutritionDay(f.connection, { ...day(), nutrition: { intake: null } });
        expect(await f.repo.readNutritionDay(f.connection.personId, "2026-11-21")).toMatchObject({ values: { consumedCaloriesKcal: null, consumedFluidMl: 0 } });
        await f.repo.importNutritionDay(f.connection, { ...day(), nutrition: { hydration: null } });
        expect(await f.repo.readNutritionDay(f.connection.personId, "2026-11-21")).toBeNull();
    });
    it("requires exact Person/generation/category scope and rejects negative SQL measurements", async () => {
        const f = await fixture();
        await db.pool.query("update recovery_consents set integration_import_scopes=ARRAY['recovery','training'] where id=$1", [f.connection.consentId]);
        expect(await f.repo.importNutritionDay(f.connection, day())).toBe("stopped");
        expect(await f.repo.importBodyMeasurement(f.connection, body())).toBe("stopped");
        expect(await f.repo.importFitnessDay({ ...f.connection, personId: randomUUID() }, day())).toBe("stopped");
        expect(await f.repo.importFitnessDay({ ...f.connection, consentId: randomUUID() }, day())).toBe("stopped");
        expect(await f.repo.importFitnessDay(f.connection, day())).toBe("created");
        await expect(db.pool.query("update connected_daily_fitness set active_expenditure_kcal=-1 where person_id=$1", [f.connection.personId])).rejects.toThrow();
    });
    it("links only actual weight, corrects idempotently and creates no mass from composition alone", async () => {
        const f = await fixture();
        expect(await f.repo.importBodyMeasurement(f.connection, body())).toBe("created");
        expect(await f.repo.importBodyMeasurement(f.connection, body())).toBe("unchanged");
        expect(await f.repo.importBodyMeasurement(f.connection, { ...body(), weightKg: 76, composition: { ...body().composition, bodyFatPercent: 19 } })).toBe("corrected");
        expect(await f.repo.importBodyMeasurement(f.connection, body())).toBe("corrected");
        const rows = await f.repo.listBodyComposition(f.connection.personId);
        expect(rows).toMatchObject([{ version: 3, values: { bodyFatPercent: 20 } }]);
        expect(rows[0]!.weightMeasurementId).toBeTruthy();
        await f.repo.importBodyMeasurement(f.connection, { ...body("composition-only"), weightKg: null });
        expect((await db.pool.query("select count(*)::int as n from weight_measurements where person_id=$1", [f.connection.personId])).rows[0].n).toBe(3);
    });
    it("uses actual body instant in cutover timezone rather than supplied label", async () => {
        const f = await fixture();
        await db.pool.query("insert into integration_cutovers(person_id,target_connection_id,target_recovery_connection_id,target_consent_id,starts_on,timezone,starts_at,source_drains_until,state,activated_at,capability_version,dedupe_key) values($1,$2,$3,$4,'2026-11-21','Europe/Moscow','2026-11-20T21:00:00Z','2026-12-05T21:00:00Z','active',now(),'synthetic',$5)", [f.connection.personId, f.connection.id, f.recoveryConnectionId, f.connection.consentId, randomUUID()]);
        expect(await f.repo.importBodyMeasurement(f.connection, { ...body(), localDate: "2099-01-01", measuredAt: "2026-11-20T20:59:59.000Z" })).toBe("stopped");
        expect(await f.repo.importBodyMeasurement(f.connection, { ...body(), localDate: "2026-11-20", measuredAt: "2026-11-20T21:00:00.000Z" })).toBe("created");
        expect(await f.repo.listBodyComposition(f.connection.personId)).toMatchObject([{ localDate: "2026-11-21" }]);
    });
    it("blocks late writes on erasure and replay deletes all owned new facts, preserving manual weights", async () => {
        const f = await fixture();
        await f.repo.importFitnessDay(f.connection, day());
        await f.repo.importNutritionDay(f.connection, day());
        await f.repo.importBodyMeasurement(f.connection, body());
        const manualSource = randomUUID();
        await db.pool.query("insert into source_references(id,person_id,channel) values($1,$2,'manual')", [manualSource, f.connection.personId]);
        await db.pool.query("insert into weight_measurements(person_id,measured_at,local_date,timezone,weight_kg,source,source_reference_id,dedupe_key) values($1,now(),'2026-11-21','Europe/Moscow',80,'manual',$2,$3)", [f.connection.personId, manualSource, randomUUID()]);
        const recovery = new RecoveryRepository(db);
        const request = await recovery.requestErasure(f.connection.personId, f.recoveryConnectionId, randomUUID(), "user_request", randomUUID());
        expect(await f.repo.importNutritionDay(f.connection, day())).toBe("stopped");
        expect(await f.repo.readFitnessDays(f.connection.personId,"2026-11-21","2026-11-21")).toEqual([]);
        expect(await f.repo.readNutritionDay(f.connection.personId,"2026-11-21")).toBeNull();
        expect(await f.repo.listBodyComposition(f.connection.personId)).toEqual([]);
        const weights=new WeightMeasurementRepository(db);
        const ownedWeight=(await db.pool.query("select id from weight_measurements where person_id=$1 and integration_connection_id=$2",[f.connection.personId,f.connection.id])).rows[0].id;
        expect(await weights.findById(f.connection.personId,ownedWeight)).toBeNull();
        expect(await weights.history(f.connection.personId,ownedWeight)).toBeNull();
        expect((await weights.list(f.connection.personId,100)).items).toHaveLength(1);
        expect(await weights.listForLocalDate(f.connection.personId,"2026-11-21")).toHaveLength(1);
        expect(await weights.listForLocalDateRange(f.connection.personId,"2026-11-21","2026-11-21")).toHaveLength(1);
        await recovery.replayErasureMarker({ id: request.id, personId: f.connection.personId, connectionId: f.recoveryConnectionId, reason: "user_request", requestedAt: request.requestedAt });
        expect(await f.repo.readFitnessDays(f.connection.personId, "2026-11-21", "2026-11-21")).toEqual([]);
        expect(await f.repo.readNutritionDay(f.connection.personId, "2026-11-21")).toBeNull();
        expect(await f.repo.listBodyComposition(f.connection.personId)).toEqual([]);
        expect((await db.pool.query("select weight_kg from weight_measurements where person_id=$1", [f.connection.personId])).rows).toEqual([{ weight_kg: "80.000" }]);
    });
});
