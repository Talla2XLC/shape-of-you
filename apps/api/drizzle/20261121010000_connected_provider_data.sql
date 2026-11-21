ALTER TABLE integration_connections ADD CONSTRAINT integration_connection_id_person_uq UNIQUE(id,person_id);
ALTER TABLE recovery_consents ADD CONSTRAINT recovery_consent_id_person_uq UNIQUE(id,person_id);
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'stress_average';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'stress_maximum';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'stress_rest_minutes';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'stress_low_minutes';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'stress_medium_minutes';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'stress_high_minutes';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'stress_activity_minutes';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'stress_uncategorized_minutes';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'body_battery_charged';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'body_battery_drained';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'daily_respiration_rate';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'daily_respiration_rate_minimum';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'daily_respiration_rate_maximum';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'daily_oxygen_saturation';
ALTER TYPE recovery_metric ADD VALUE IF NOT EXISTS 'daily_minimum_oxygen_saturation';
ALTER TABLE recovery_consents ADD COLUMN integration_import_scopes text[] NOT NULL DEFAULT '{}';
UPDATE recovery_consents consent SET integration_import_scopes=ARRAY['recovery','training'] WHERE EXISTS(SELECT 1 FROM integration_connections c WHERE c.recovery_connection_id=consent.connection_id AND c.person_id=consent.person_id);
ALTER TABLE recovery_consents ADD CONSTRAINT consent_import_scopes_valid CHECK(integration_import_scopes <@ ARRAY['recovery','training','physical_state','nutrition']::text[]);
ALTER TABLE weight_measurements ADD COLUMN integration_connection_id uuid, ADD COLUMN integration_consent_id uuid, ADD COLUMN integration_source_identity varchar(256);
ALTER TABLE weight_measurements ADD CONSTRAINT weight_integration_owner_shape CHECK((integration_connection_id IS NULL AND integration_consent_id IS NULL AND integration_source_identity IS NULL) OR (integration_connection_id IS NOT NULL AND integration_consent_id IS NOT NULL AND integration_source_identity IS NOT NULL AND source::text='account'));
ALTER TABLE recovery_sleep_details ADD COLUMN awake_sleep_minutes smallint CHECK(awake_sleep_minutes BETWEEN 0 AND 1440);
ALTER TABLE recovery_sleep_details ADD COLUMN sleep_need_minutes smallint CHECK(sleep_need_minutes BETWEEN 0 AND 1440);
ALTER TABLE recovery_sleep_details ADD COLUMN sleep_need_baseline_minutes smallint CHECK(sleep_need_baseline_minutes BETWEEN 0 AND 1440);
ALTER TABLE recovery_sleep_details ADD COLUMN next_sleep_need_minutes smallint CHECK(next_sleep_need_minutes BETWEEN 0 AND 1440);
ALTER TABLE recovery_sleep_details ADD COLUMN next_sleep_need_baseline_minutes smallint CHECK(next_sleep_need_baseline_minutes BETWEEN 0 AND 1440);
ALTER TABLE recovery_sleep_details ADD COLUMN breathing_disruption_severity varchar(16) CHECK(breathing_disruption_severity IN ('NONE','LOW','MEDIUM','HIGH','UNMEASURABLE'));
ALTER TABLE integration_activity_facts ADD COLUMN training_stress_score numeric(14,3) CHECK(training_stress_score BETWEEN 0 AND 10000);
ALTER TABLE integration_activity_facts ADD COLUMN provider_exercise_load numeric(14,3) CHECK(provider_exercise_load BETWEEN 0 AND 100000);
ALTER TABLE integration_activity_facts ADD COLUMN aerobic_training_effect numeric(14,3) CHECK(aerobic_training_effect BETWEEN 0 AND 5);
ALTER TABLE integration_activity_facts ADD COLUMN anaerobic_training_effect numeric(14,3) CHECK(anaerobic_training_effect BETWEEN 0 AND 5);
ALTER TABLE integration_activity_facts ADD COLUMN calories_kcal numeric(14,3) CHECK(calories_kcal BETWEEN 0 AND 100000);
ALTER TABLE integration_activity_facts ADD COLUMN average_power_watts numeric(14,3) CHECK(average_power_watts BETWEEN 0 AND 10000);
ALTER TABLE integration_activity_facts ADD COLUMN normalized_power_watts numeric(14,3) CHECK(normalized_power_watts BETWEEN 0 AND 10000);
ALTER TABLE integration_activity_facts ADD COLUMN maximum_power_watts numeric(14,3) CHECK(maximum_power_watts BETWEEN 0 AND 10000);
ALTER TABLE integration_activity_facts ADD COLUMN intensity_factor numeric(14,3) CHECK(intensity_factor BETWEEN 0 AND 10);
ALTER TABLE integration_activity_facts ADD COLUMN body_battery_delta numeric(14,3) CHECK(body_battery_delta BETWEEN -100 AND 100);
ALTER TABLE integration_activity_facts ADD COLUMN provider_exercise_load_basis varchar(64);
ALTER TABLE integration_activity_facts ADD CONSTRAINT activity_provider_load_basis CHECK((provider_exercise_load IS NULL AND provider_exercise_load_basis IS NULL) OR (provider_exercise_load IS NOT NULL AND provider_exercise_load_basis IS NOT NULL AND provider_exercise_load_basis='garmin_activity_training_load_v1'));
CREATE TABLE connected_daily_fitness (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
 consent_id uuid NOT NULL REFERENCES recovery_consents(id) ON DELETE CASCADE,
 provider varchar(64) NOT NULL,source_identity varchar(256) NOT NULL,local_date date NOT NULL,timezone varchar(64) NOT NULL,
 normalized_checksum varchar(64) NOT NULL,version integer NOT NULL CHECK(version>0),supersedes_id uuid,withdrawn boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
resting_expenditure_kcal numeric(14,3) CHECK(resting_expenditure_kcal BETWEEN 0 AND 1000000),
active_expenditure_kcal numeric(14,3) CHECK(active_expenditure_kcal BETWEEN 0 AND 1000000),
total_expenditure_kcal numeric(14,3) CHECK(total_expenditure_kcal BETWEEN 0 AND 1000000),
movement_distance_meters numeric(14,3) CHECK(movement_distance_meters BETWEEN 0 AND 1000000),
floors_up numeric(14,3) CHECK(floors_up BETWEEN 0 AND 1000000),
floors_down numeric(14,3) CHECK(floors_down BETWEEN 0 AND 1000000),
moderate_minutes numeric(14,3) CHECK(moderate_minutes BETWEEN 0 AND 1440),
vigorous_minutes numeric(14,3) CHECK(vigorous_minutes BETWEEN 0 AND 1440),
fitness_age_years numeric(14,3) CHECK(fitness_age_years BETWEEN 0 AND 150),
achievable_fitness_age_years numeric(14,3) CHECK(achievable_fitness_age_years BETWEEN 0 AND 150),
vo2_max numeric(14,3) CHECK(vo2_max BETWEEN 0 AND 150),
vo2_max_cycling numeric(14,3) CHECK(vo2_max_cycling BETWEEN 0 AND 150),
vo2_max_rowing numeric(14,3) CHECK(vo2_max_rowing BETWEEN 0 AND 150),
fitness_age_as_of date,
fitness_age_computed_at timestamptz
);
CREATE UNIQUE INDEX connected_daily_fitness_successor_uq ON connected_daily_fitness(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX connected_daily_fitness_person_date_idx ON connected_daily_fitness(person_id,local_date);
CREATE TABLE connected_nutrition_days (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
 consent_id uuid NOT NULL REFERENCES recovery_consents(id) ON DELETE CASCADE,
 provider varchar(64) NOT NULL,source_identity varchar(256) NOT NULL,local_date date NOT NULL,timezone varchar(64) NOT NULL,
 normalized_checksum varchar(64) NOT NULL,version integer NOT NULL CHECK(version>0),supersedes_id uuid,withdrawn boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
consumed_calories_kcal numeric(14,3) CHECK(consumed_calories_kcal BETWEEN 0 AND 1000000),
protein_grams numeric(14,3) CHECK(protein_grams BETWEEN 0 AND 1000000),
fat_grams numeric(14,3) CHECK(fat_grams BETWEEN 0 AND 1000000),
carbohydrate_grams numeric(14,3) CHECK(carbohydrate_grams BETWEEN 0 AND 1000000),
consumed_fluid_ml numeric(14,3) CHECK(consumed_fluid_ml BETWEEN 0 AND 1000000)
);
CREATE UNIQUE INDEX connected_nutrition_days_successor_uq ON connected_nutrition_days(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX connected_nutrition_days_person_date_idx ON connected_nutrition_days(person_id,local_date);
CREATE TABLE body_composition_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
 consent_id uuid NOT NULL REFERENCES recovery_consents(id) ON DELETE CASCADE,
 provider varchar(64) NOT NULL,source_identity varchar(256) NOT NULL,local_date date NOT NULL,timezone varchar(64) NOT NULL,
 normalized_checksum varchar(64) NOT NULL,version integer NOT NULL CHECK(version>0),supersedes_id uuid,withdrawn boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
body_fat_percent numeric(14,3) CHECK(body_fat_percent BETWEEN 0 AND 100),
body_water_percent numeric(14,3) CHECK(body_water_percent BETWEEN 0 AND 100),
muscle_mass_kg numeric(14,3) CHECK(muscle_mass_kg BETWEEN 0 AND 700),
bone_mass_kg numeric(14,3) CHECK(bone_mass_kg BETWEEN 0 AND 700),
bmi numeric(14,3) CHECK(bmi BETWEEN 0 AND 200),
measured_at timestamptz,
weight_measurement_id uuid REFERENCES weight_measurements(id)
);
CREATE UNIQUE INDEX body_composition_observations_successor_uq ON body_composition_observations(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX body_composition_observations_person_date_idx ON body_composition_observations(person_id,local_date);

ALTER TABLE weight_measurements ADD CONSTRAINT weight_integration_connection_fk FOREIGN KEY(integration_connection_id,person_id) REFERENCES integration_connections(id,person_id), ADD CONSTRAINT weight_integration_consent_fk FOREIGN KEY(integration_consent_id,person_id) REFERENCES recovery_consents(id,person_id);
ALTER TABLE connected_daily_fitness ADD CONSTRAINT connected_daily_fitness_id_person_uq UNIQUE(id,person_id), ADD CONSTRAINT connected_daily_fitness_owner_connection_fk FOREIGN KEY(connection_id,person_id) REFERENCES integration_connections(id,person_id) ON DELETE CASCADE, ADD CONSTRAINT connected_daily_fitness_owner_consent_fk FOREIGN KEY(consent_id,person_id) REFERENCES recovery_consents(id,person_id) ON DELETE CASCADE, ADD CONSTRAINT connected_daily_fitness_supersedes_fk FOREIGN KEY(supersedes_id,person_id) REFERENCES connected_daily_fitness(id,person_id);
ALTER TABLE connected_nutrition_days ADD CONSTRAINT connected_nutrition_days_id_person_uq UNIQUE(id,person_id), ADD CONSTRAINT connected_nutrition_days_owner_connection_fk FOREIGN KEY(connection_id,person_id) REFERENCES integration_connections(id,person_id) ON DELETE CASCADE, ADD CONSTRAINT connected_nutrition_days_owner_consent_fk FOREIGN KEY(consent_id,person_id) REFERENCES recovery_consents(id,person_id) ON DELETE CASCADE, ADD CONSTRAINT connected_nutrition_days_supersedes_fk FOREIGN KEY(supersedes_id,person_id) REFERENCES connected_nutrition_days(id,person_id);
ALTER TABLE body_composition_observations ADD CONSTRAINT body_composition_observations_id_person_uq UNIQUE(id,person_id), ADD CONSTRAINT body_composition_observations_owner_connection_fk FOREIGN KEY(connection_id,person_id) REFERENCES integration_connections(id,person_id) ON DELETE CASCADE, ADD CONSTRAINT body_composition_observations_owner_consent_fk FOREIGN KEY(consent_id,person_id) REFERENCES recovery_consents(id,person_id) ON DELETE CASCADE, ADD CONSTRAINT body_composition_observations_supersedes_fk FOREIGN KEY(supersedes_id,person_id) REFERENCES body_composition_observations(id,person_id);
ALTER TABLE body_composition_observations ADD CONSTRAINT body_composition_weight_fk FOREIGN KEY(weight_measurement_id,person_id) REFERENCES weight_measurements(id,person_id);

ALTER TABLE recovery_sleep_details ADD COLUMN sleep_kind varchar(16) CHECK(sleep_kind IN ('main_sleep','nap'));
ALTER TABLE recovery_metric_details DROP CONSTRAINT recovery_metric_details_shape;
ALTER TABLE recovery_metric_details ADD CONSTRAINT recovery_metric_details_shape CHECK(value >= -100 AND value <= 1000000
          AND ((metric::text = 'hrv_rmssd' AND value > 0 AND unit::text = 'ms')
            OR (metric::text IN ('resting_heart_rate', 'night_heart_rate') AND value > 0 AND unit::text = 'bpm')
            OR (metric::text IN ('oxygen_saturation', 'minimum_oxygen_saturation') AND value >= 0 AND value <= 100 AND unit::text = 'percent')
            OR (metric::text = 'temperature_deviation' AND value >= -20 AND value <= 20 AND unit::text = 'celsius')
            OR (metric::text = 'respiration_rate' AND value > 0 AND value <= 100 AND unit::text = 'breaths_per_minute')
            OR (metric::text IN ('body_battery', 'body_battery_min', 'body_battery_max', 'sleep_score') AND value >= 0 AND value <= 100 AND unit::text = 'score')
            OR (metric::text = 'steps' AND value >= 0 AND value <= 1000000 AND trunc(value) = value AND unit::text = 'count')
            OR (metric::text IN ('stress_average','stress_maximum') AND value BETWEEN 0 AND 100 AND unit::text='score')
            OR (metric::text IN ('stress_rest_minutes','stress_low_minutes','stress_medium_minutes','stress_high_minutes','stress_activity_minutes','stress_uncategorized_minutes') AND value BETWEEN 0 AND 1440 AND unit::text='minute')
            OR (metric::text IN ('body_battery_charged','body_battery_drained') AND value BETWEEN 0 AND 1000 AND unit::text='score')
            OR (metric::text IN ('daily_respiration_rate','daily_respiration_rate_minimum','daily_respiration_rate_maximum') AND value>0 AND value<=100 AND unit::text='breaths_per_minute')
            OR (metric::text IN ('daily_oxygen_saturation','daily_minimum_oxygen_saturation') AND value BETWEEN 0 AND 100 AND unit::text='percent')
            OR (metric::text = 'garmin_post_activity_recovery_time' AND value >= 0 AND value <= 65534 AND trunc(value) = value AND unit::text = 'minute')));
