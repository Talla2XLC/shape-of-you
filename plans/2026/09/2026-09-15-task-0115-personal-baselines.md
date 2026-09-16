# TASK-0115 — Личные baseline и trend-aware ежедневная оценка

## Статус

Источники architecture authority — принятые
[hybrid baseline ADR](../../../docs/adr/20260915-use-hybrid-personal-baselines-for-daily-assessment.md)
и [counterfactual replay ADR](../../../docs/adr/20260915-replay-daily-assessment-v1-with-explicit-ambiguity.md).
Ниже сохранён операторский review record и порядок выполнения; при расхождении
ADR имеет приоритет и план не создаёт второй архитектурный контракт.

Архитектура и план одобрены оператором 2026-09-15 командой «го». Первый
Developer slice (shadow baseline primitives, typed travel eligibility и
privacy-safe retrospective harness) реализован локально, принят независимым
Quality и финальным Architecture Review, а affected canonical Wiki обновлена.
Оператор отдельно разрешил read-only staging dry-run для своей Person. Первый
baseline-only calibration run выполнен без записей и персональных полей в
отчёте. Он подтвердил пригодность истории для sleep, HRV и resting heart rate,
но на staging отсутствуют сохранённые `daily-assessment-v1` snapshots и ещё не
применены typed context columns. Поэтому status/action stability нельзя
измерить и production candidate выбирать нельзя. Локальный counterfactual
replay slice после отдельного одобрения реализован, принят независимым Quality
после двух rework cycles и новым Architecture Review; affected Wiki обновлена.
Отдельно разрешённый staging dry-run новой версии выполнен через ephemeral
stdin runtime без deploy и записей. Production bundle, активация
`daily-assessment-v2`, migration apply, commit, push и deploy не разрешены.

## Counterfactual staging dry-run — 2026-09-16

Aggregate-only `reportVersion = 2` оценил 366 target days. Stored-v1 snapshots
по-прежнему отсутствуют. Counterfactual envelope признал сопоставимыми 89 дней,
а 277 дней пометил `ambiguous_program_state`; evidence-free days отсутствовали.
Typed context columns на staging отсутствуют, поэтому context eligibility для
всех 366 дней честно помечена unavailable и travel не интерпретировался.

Все candidates прошли minimum 30 comparable days. `responsive` получил на одно
переключение меньше, но создал 9 personal-overlay переходов caution→recovery
priority против 3 у `balanced` и `stable`. `balanced` и `stable` дали одинаковые
decision distributions, transitions и один A-B-A reversal; `stable` потребовал
более длинную историю без измеренного decision benefit. Поэтому автоматический
ranking `responsive → balanced → stable` не принимается как production choice.
Product + Analytic рекомендуют `balanced` только как следующий prospective
shadow candidate: это средний адаптивный bundle без лишней чувствительности и
без 120-дневной инерции. Production activation остаётся заблокированной до
prospective stored-v1 evidence, typed context migration и typed Training load
basis/version contract.

Invariant violations равны нулю у всех candidates. Wrapper подтвердил
неизменность числа Coaching records до/после, `writesPerformed = false` и
удаление всех временных host/container artifacts.

## Простое объяснение пользовательского результата

Shape of You должен говорить не «показатель плохой», а, например:

> Сегодня лучше не повышать нагрузку. Сон был заметно короче твоего обычного,
> HRV второй день ниже твоего обычного диапазона, а пульс покоя выше него.
> Недавняя тренировочная нагрузка тоже выше твоего привычного уровня. Это не
> диагноз: рекомендация основана только на доступных данных и консервативных
> правилах безопасности.

Если личной истории недостаточно, результат должен честно сказать, что личная
норма ещё не сформирована, и использовать только абсолютные safety guardrails
и доступные факты.

## Цель

Расширить API-owned deterministic daily assessment из TASK-0112 так, чтобы она
учитывала устойчивую личную норму HRV, resting heart rate, длительности сна,
Body Battery и совместимой тренировочной нагрузки, показывала направление
изменения простыми словами и сохраняла существующие safety, ownership,
reproducibility и provider-neutral границы.

## Альтернативы

### A. Только абсолютные пороги

Плюсы: простота, ранняя доступность, понятные safety limits. Минусы: одинаковый
порог для разных людей, слабая чувствительность к значимому личному изменению и
ложное спокойствие, когда показатель ещё не пересёк общий порог.

### B. Только personal rolling baselines

Плюсы: высокая персонализация и естественное объяснение относительно обычного
состояния. Минусы: нет результата при короткой истории, риск принять хронически
неблагоприятное состояние за норму, дрейф после болезни/путешествия и высокая
чувствительность к пропускам или выбросам.

### C. Гибрид абсолютных safety guardrails и personal baselines

Рекомендуется. Абсолютный hard stop всегда доминирует; личная норма уточняет
контекст, когда данных достаточно. Недостаточный baseline не ослабляет safety,
а baseline, находящийся за guardrail, называется только «твоим недавним обычным
уровнем», но не «здоровой нормой» и не разрешает статус `ready`.

## Предлагаемая архитектура

1. Сохранить существующий Coaching ownership и `daily_next_action`; не создавать
   новый bounded context, `PersonalBaseline` aggregate, микросервис, scheduler,
   generic rules engine или LLM dependency.
2. Ввести `daily-assessment-v2` и immutable typed detail для его policy
   parameters. Policy хранит минимальное число eligible days, правила отбора,
   adaptive lookback limits, robust estimator, trend persistence, guardrails и
   action precedence. Параметры не берутся из env и не скрываются в коде без
   version pin.
3. Baseline вычислять как чистую projection над current Person-owned typed
   facts на момент оценки. День оценки исключается из reference distribution,
   чтобы сегодняшнее значение не меняло собственную точку сравнения.
4. Не хранить mutable «текущий baseline». Immutable DailyAssessment snapshot
   должен содержать policy version, canonical input checksum, typed baseline
   calculation snapshot, eligible/excluded counts, фактический диапазон истории,
   current comparison bands и использованные evidence IDs.
5. Recovery остаётся владельцем качества и семантики HRV, resting heart rate,
   sleep и Body Battery. Training остаётся владельцем activity/load facts.
   Coaching получает только bounded provider-neutral read models и выбирает
   cross-domain action.
6. ChatGPT/MCP только представляет точный `DailyAssessmentResult`; оно не
   рассчитывает baseline, не интерпретирует free text для eligibility и не
   меняет status/action.

## Модель baseline

### Eligibility

- Baseline строится отдельно по каждому показателю; отсутствие одного не
  блокирует остальные.
- Минимум для персонального сравнения: **14 разных completed Person-local days**
  с usable evidence для конкретного показателя.
- Для training load дополнительно требуется представительность: eligible
  load-days должны охватывать не менее трёх разных календарных недель. Нулевой
  load не подставляется, если домен не может доказать полноту дня.
- Используются только current, non-withdrawn, `person_context`, совместимые по
  metric/unit и не `poor` facts. Значение оцениваемого дня не входит в baseline.
- Пропуски не интерполируются и не превращаются в нули. Snapshot показывает
  candidate, eligible и excluded counts и причину недоступности baseline.

### Adaptive history window

Вместо немедленного выбора «7/28/90 дней» policy задаёт четыре параметра:

- `minimumEligibleDays` — порог доступности personal baseline;
- `targetEligibleDays` — сколько последних eligible samples желательно набрать;
- `maximumLookbackDays` — предельная календарная глубина;
- `minimumRecentCoverage` — защита от baseline, собранного в основном из старых
  данных.

Алгоритм идёт назад от D-1, пока не наберёт target samples или не достигнет
maximum lookback. Числа, кроме минимальных 14 eligible days, не фиксируются до
retrospective dry-run; сравниваются несколько immutable candidate bundles.

### Устойчивый расчёт и trend

- Один deterministic daily representative на metric: внутри дня сначала
  применяется owner-defined provider-neutral consolidation, затем дни имеют
  одинаковый вес независимо от количества импортированных records.
- Reference center — median eligible daily representatives.
- Разброс — MAD; при нулевом/неинформативном MAD используется заранее заданный
  empirical percentile band. Mean/standard deviation не являются основными,
  чтобы единичный выброс не сдвигал норму.
- Наружу возвращаются qualitative bands (`below_usual`, `within_usual`,
  `above_usual`, `baseline_unavailable`) и простая фраза. Внутренняя точная
  арифметика остаётся в typed calculation snapshot, без псевдомедицинского
  score.
- Trend выводится из последовательности последних eligible comparisons, а не
  из одного скачка. Persistence length и severe-deviation threshold являются
  versioned parameters и выбираются по dry-run. Абсолютный guardrail может
  сработать по одному дню.

### Семантика показателей

- Sleep: один owner-defined основной usable sleep representative на local date;
  naps и дубли не суммируются автоматически.
- HRV и resting heart rate: сравниваются только одинаковые typed metric/unit;
  несколько usable readings дня консолидируются детерминированно владельцем.
- Body Battery: direct point, daily minimum и daily maximum не смешиваются.
  Today's max сравнивается с historical max, min — с min; range не выдаётся за
  current reading.
- Training load: используются только явные совместимые typed `trainingLoad`
  facts. Personal comparison описывает recorded load-days; отсутствие activity
  не считается нулём без доказанной day completeness. Existing workout-count и
  Recovery load-risk guardrails продолжают работать независимо.

### Болезни, путешествия и хронически плохое состояние

- `acuteIllness`, `injuryConcern` и Recovery hard stop участвуют в текущей
  оценке, но соответствующие дни и policy-defined recovery buffer исключаются
  из baseline adaptation.
- Путешествие не угадывается по provider, timezone или значениям. Для
  автоматического исключения нужен typed user-declared marker в существующем
  DailyContextNote contract (`contextKind = travel` и явный eligibility impact),
  либо дни остаются в данных и помечаются как unknown context. Free-text note
  не интерпретируется доменной policy.
- Резкий согласованный сдвиг нескольких signals переводит baseline quality в
  `unstable` и временно замораживает адаптацию, но не создаёт диагноз.
- Absolute guardrails всегда имеют приоритет. Если median baseline сам находится
  за guardrail, policy не называет его здоровой нормой, не разрешает `ready` и
  объясняет: «это твой недавний обычный уровень, но он всё ещё за консервативной
  границей».

## Corrections, late imports и воспроизводимость

1. Canonical checksum включает точный policy version, target local date/timezone,
   selected current evidence IDs, typed daily representatives, exclusions,
   baseline calculation и current comparisons.
2. Correction, withdrawal, deletion или late import в пределах фактически
   использованного lookback меняет current evidence set. Следующий read создаёт
   новый immutable snapshot; mutable invalidation flag не нужен.
3. Старый snapshot не пересчитывается и сохраняет точный calculation snapshot.
   Privacy erasure продолжает физически удалять snapshots, удерживающие erased
   evidence, по существующему Recovery/connection contract.
4. A-B-A фактология должна возвращаться к тому же semantic checksum при той же
   policy и canonical evidence, даже если snapshot identity reuse определяется
   существующим persistence contract.
5. Не вводится eager mass recalculation. Историческая переоценка выполняется
   только отдельным read-only dry-run и не заменяет старые рекомендации.

## Retrospective dry-run

Dry-run является первым delivery slice после одобрения архитектуры и плана.
Он требует отдельного разрешения на чтение конкретного environment и Person;
в рамках текущего shaping реальные staging/production данные не читаются.

### Safety contract

- read-only transaction или отдельный API-owned offline reader;
- никаких inserts/updates/deletes, snapshots, recommendations или side effects;
- исходные values, даты, Person ID, provider identity и raw payload не пишутся
  в stdout, logs, task timeline или chat;
- candidate policy работает в памяти процесса; сохраняется только агрегированный
  de-identified policy report;
- отчёт не содержит daily rows и не позволяет восстановить конкретный день;
- report generation fail-closed при попытке включить запрещённое поле.

### Сравнение

Для каждого eligible исторического дня вычислить shadow results для
`daily-assessment-v1` и нескольких candidate v2 bundles без изменения
пользовательского результата. Агрегированный отчёт содержит:

- число evaluable/insufficient дней и baseline availability по metric;
- распределение status/action и v1→v2 transition matrix;
- day-to-day switches, A-B-A flip-flops и severe single-day jumps;
- долю решений, где сработал absolute guardrail или persistent personal trend;
- excluded/missing/unstable baseline counts по reason code;
- suspicious invariants: `ready` за guardrail, recovery action без supporting
  signal, хронически неблагоприятный median, unit mixing, zero-imputation,
  зависимость от provider и изменение результата от record duplication;
- sensitivity ranking candidate bundles без публикации персональных значений.

Dry-run не выбирает policy автоматически. Product + Analytic показывают
агрегаты и рекомендуют один immutable parameter bundle; оператор отдельно
утверждает production activation.

### Delta: counterfactual replay после baseline-only результата

Первый разрешённый staging dry-run не нашёл stored `daily-assessment-v1`
snapshots, поэтому baseline availability проверена, но decision stability
сравнить нельзя. После отдельного архитектурного согласования принят ADR
`20260915-replay-daily-assessment-v1-with-explicit-ambiguity.md`.

Developer slice:

1. Добавить режим `counterfactual-current-facts-v1`, не меняя stored-v1 режим.
2. Собрать bounded current typed facts для каждого target day без future-window
   leakage и вызвать существующий `evaluateDailyAssessment`.
3. Проверить `program_absent` и `program_present`; использовать день только при
   одинаковых status/action type, иначе пометить aggregate reason
   `ambiguous_program_state` и разорвать continuity.
4. Разделить stored, counterfactual comparable, ambiguous и unavailable counts.
5. Не публиковать sensitivity ranking при числе comparable target days меньше
   30 и никогда не активировать candidate автоматически.
6. Feature-detect typed DailyContextNote columns; при их отсутствии пометить
   context eligibility unavailable, не анализируя free text.
7. Расширить aggregate-only fail-closed serializer и negative privacy tests.
8. Пройти Developer → независимый Quality → Architecture Review → Wiki.

Этот delta разрешает только локальные изменения и проверки. Он не разрешает
staging/production read, migration execution, policy activation, commit, push
или deploy.

## Пример детерминированной оценки

Условный набор: sleep немного выше абсолютного short-sleep guardrail, но заметно
короче personal usual band; HRV второй eligible день ниже usual; resting heart
rate выше usual; recorded recent training load выше personal recorded-load band;
hard stop отсутствует.

Результат: `caution` или `recovery_priority` согласно versioned combination
rule, reason codes указывают personal deviations и recent load, action остаётся
`recovery_first`. Объяснение не называет заболевание, причину или процент
«готовности» и не придумывает тренировку.

## Объём после одобрения

1. Создать и принять новый русский ADR, уточняющий ADR 20260914.
2. Добавить typed `daily-assessment-v2` policy parameters и baseline calculation
   contract без generic JSON authority.
3. Добавить bounded owner reads и deterministic daily consolidation для Recovery
   и Training; не читать raw provider payload.
4. Добавить typed travel eligibility marker в существующий DailyContextNote
   contract либо явно отложить travel exclusion и оставить fail-closed
   `unknown_context` — это отдельный пункт архитектурного согласования.
5. Реализовать локальный read-only retrospective harness и агрегированный
   privacy-safe report; выполнить его только после отдельного data-access gate.
6. После выбора candidate bundle реализовать v2 evaluator, immutable snapshot,
   correction/withdrawal/late-import behavior и exact MCP presentation.
7. Пройти Developer → независимый Quality → Architecture Review → Wiki.

## Не входит

- медицинский диагноз, лечение, health/readiness score или причинный вывод;
- LLM в baseline/domain authority;
- provider-specific thresholds, Garmin/Intervals branches или raw payload;
- автоматическое изменение TrainingProgram или запись выполненной тренировки;
- mutable baseline profile, background scheduler, queue, microservice, database;
- изменение текущих рекомендаций во время dry-run;
- staging/production read, migration apply, commit, push или deploy без отдельных
  разрешений.

## Риски

1. Adaptive baseline может дрейфовать вслед за хронически плохим состоянием —
   сдерживается absolute guardrails, exclusion/freeze и `unstable` quality.
2. Короткая или дырявая история создаёт ложную уверенность — baseline unavailable
   до 14 eligible days; пропуски не заполняются.
3. Несовместимые training-load semantics — сравниваются только совместимые typed
   facts; иначе personal load baseline unavailable.
4. Late imports меняют последующие baselines — checksum и immutable snapshot
   versioning делают изменение явным и воспроизводимым.
5. Частые переключения статуса — trend persistence и retrospective switch/
   flip-flop report до activation.
6. Typed travel marker расширяет public/domain contract — требуется явное
   архитектурное решение; free text не является безопасной заменой.
7. Более глубокий lookback увеличивает query cost — bounded owner reads и query
   plan verification precede any caching/materialization proposal.

## Необходимость ADR

Новый ADR обязателен. Меняются durable Coaching policy semantics, typed
snapshot/evidence contract, baseline eligibility, historical correction impact
и DailyContextNote travel semantics. ADR должен уточнить, но не отменять
решение `20260914-own-daily-assessment-and-next-action-in-api`: API/Coaching
остаётся единственной deterministic authority, а immutable snapshot pattern и
MCP presentation boundary сохраняются.

## Порядок реализации после одобрения

1. Согласовать hybrid model, минимум 14 eligible days, adaptive parameter family,
   robust estimator, chronic-state guard и travel-marker решение.
2. Написать и принять русский ADR; validator должен пройти до source code.
3. Реализовать pure baseline primitives и candidate policies с table tests.
4. Реализовать bounded owner reads и privacy-safe retrospective harness.
5. Остановиться на отдельный data-access gate; выполнить dry-run только на
   разрешённой истории и показать агрегированный report.
6. Согласовать один production parameter bundle и activation criteria.
7. Реализовать strict contracts, policy v2, snapshot persistence/evidence и
   correction/deletion behavior; сгенерировать additive migration при
   необходимости и проверить PostgreSQL identifiers ≤63 UTF-8 bytes.
8. Проверить exact HTTP/MCP delivery без prompt-side recalculation.
9. Выполнить Developer checks и передать frozen diff независимому Quality.
10. После Quality acceptance выполнить Architecture Review по пяти workspace
    критериям; затем с отдельным разрешением обновить affected canonical Wiki и
    перенести план в `completed/`.

## Критерии приёмки

1. Absolute hard stops/guardrails всегда доминируют и не ослабляются baseline.
2. Personal comparison недоступен до 14 eligible days конкретного metric;
   missing/poor/incompatible facts не становятся нулём.
3. Median + robust spread и trend persistence детерминированы и устойчивы к
   одиночному выбросу, duplicate records и порядку импорта.
4. Baseline использует только дни до target date, current typed facts и
   provider-neutral owner semantics.
5. Illness/injury days исключаются и freeze adaptation; travel не угадывается из
   free text/provider/timezone.
6. Неблагоприятный baseline не называется здоровой нормой и не разрешает
   `ready` вопреки guardrail.
7. Correction, withdrawal, deletion и late import меняют следующий current
   snapshot через checksum; старые non-erased snapshots сохраняют exact
   policy/calculation snapshot.
8. Public explanation использует qualitative comparisons и ровно одно
   API-selected action без diagnosis, causal claim или synthetic score.
9. Training load не смешивает units/bases и не считает отсутствие факта нулём.
10. Dry-run не меняет recommendations и выдаёт только агрегированный report без
    personal values, dates, IDs, providers или raw payload в chat/logs.
11. Candidate v2 не может автоматически активироваться по результату dry-run;
    production bundle требует отдельного решения оператора.
12. Tests покрывают absolute/personal precedence, sparse history, outliers,
    exclusions, unstable shift, late imports, A-B-A, Person isolation, erasure,
    timezone/DST, MCP exactness и privacy-safe report schema.
13. Full lint/typecheck/build/tests, migration chain, identifier guard,
    `node scripts/validate-docs.mjs`, `git diff --check` и `4dt-board validate`
    проходят до Quality acceptance.
14. Независимый Quality, Architecture Review и post-acceptance Wiki завершаются
    до закрытия задачи.

## Принятые решения

1. Minimum 14 eligible days применяется ко всем recovery metrics; training load
   дополнительно охватывает не менее трёх календарных недель.
2. Существующий DailyContextNote получает typed `contextKind = travel` и
   `baselineEligibility = exclude`; free text не интерпретируется.
3. Delivery двухступенчатая: сначала privacy-safe shadow harness, затем
   отдельное утверждение production parameter bundle и policy v2.

## Developer evidence первого slice

- Добавлены три immutable shadow candidate bundles; production candidate не
  выбран и не активирован.
- Реализованы median/MAD, percentile fallback, target-day exclusion,
  per-metric missingness, trend persistence, illness/travel exclusions,
  calendar-day recovery buffer и multi-signal freeze. Excluded days не влияют
  на trend.
- Recovery и Training владеют своими bounded daily consolidation readers.
  Recovery выбирает longest sleep и median distinct typed readings; Training
  дедуплицирует normalized facts и не смешивает несколько connection semantics.
- Добавлен bounded CLI с диапазоном не более 366 дней. Он читает только typed
  provider-neutral facts и существующие v1 snapshots в `REPEATABLE READ READ
  ONLY`, откатывает транзакцию и печатает только агрегированный report.
- Existing recommendations и snapshots не меняются. Первый разрешённый
  baseline-only CLI run выполнен; обновлённый counterfactual CLI после текущего
  implementation slice ещё не запускался против внешнего environment.
- Сгенерирована additive migration только для typed DailyContextNote marker;
  migration не применялась вне локальных ephemeral integration databases.
- После независимого Quality rejection исправлены все шесть high и два medium
  findings; добавлены fail-closed report allowlist, v1/hybrid transitions,
  action/severe/reason/invariant/sensitivity агрегаты и реальные PostgreSQL
  проверки correction, withdrawal и Person isolation.
- После второго Quality rejection shadow сохраняет v1 `insufficient_data` /
  `record_recovery_check_in`, Recovery owner безопасно переносит актуальный
  windowed assessment hard stop, а Training baseline разделяет историю по
  opaque connection semantics и отдельно читает current internal sessions для
  v1-compatible workout-count guardrail.
- После третьего Quality rejection owner readers немедленно скрывают evidence
  connection с pending erasure; RecoveryAssessment используется только при
  полном совпадении current observation/session evidence в его окне; typed
  travel exclusion принимает только `person_context`. PostgreSQL tests
  фиксируют pending erasure, late import и смену Training semantics между
  днями.
- После четвёртого Quality rejection baseline eligibility и safety evidence
  разделены: `poor` не участвует в персональной статистике, но current
  subjective `acuteIllness`/`injuryConcern` сохраняет hard-stop precedence даже
  после invalidation старого assessment. Реальная PostgreSQL проверка также
  доказывает, что `operational_verification` travel note не исключает день.
- После первого Architecture Review удалена упрощённая копия v1 decision
  policy. Retrospective использует exact stored v1 status/action как base,
  разрешает только conservative downgrade, считает дни без snapshot
  несопоставимыми, прогревает maximum candidate lookback до `--from` и не
  называет connection-backed partition доказанной Training load semantics.
- После следующего Quality rejection chronic guardrail использует ровно тот же
  eligible selected-set и median, что baseline projection; latest v1 anchor
  скрывается целиком при pending erasure и не откатывается к более старому
  snapshot; malformed JSONB action делает день несопоставимым, а такой gap
  разрывает switch/A-B-A sequence.
- После дополнительного erasure review каждый сохранённый
  `externalActivityId` обязан разрешаться в existing current visible fact.
  Поэтому completed cascade deletion не может повторно допустить старый v1
  anchor; PostgreSQL regression фиксирует activity-only snapshot после erasure.
- После Person-isolation review тот же resolver требует
  `activity.person_id = retrospective Person`; негативный PostgreSQL snapshot
  Person B → activity Person C остаётся несопоставимым.
- Локальные gates после rework: typecheck и lint прошли; полный API suite и
  migration chain прошли чистым повторным запуском (45 files, 295 tests).
- Финальный независимый Quality принял frozen diff без blockers. Финальный
  Architecture Review подтвердил устранение прежних замечаний и прохождение
  пяти workspace-критериев: простота, отсутствие преждевременных deployable
  boundaries, DDD ownership, отсутствие дублированной authority и отсутствие
  обоснования для раннего caching/materialization.
- Post-acceptance Wiki обновлена только по текущему shadow-only состоянию в
  Coaching, Recovery, Training и data lifecycle; decision history остаётся в
  ADR.
- Counterfactual rework полностью разделяет stored и reconstructed sequences,
  материализует evidence-free calendar days как unavailable, выбирает ровно
  один явно обозначенный ranking mode при minimum 30 comparable days и
  feature-detects старую context schema без free-text inference.
- Финальный Quality для counterfactual slice: API 304/304, Recovery 16/16,
  DailyAssessment 5/5 и unit 215/215. Новый Architecture Review принят; Wiki
  уточняет, что exact является только общий v1 evaluator, а не historical input.

## Approval gates

- Одобрение «го» разрешило локальный Developer этап только в основном рабочем
  дереве и только в объёме утверждённого плана.
- Чтение staging/production history для dry-run требует отдельного разрешения с
  указанием environment и purpose.
- Wiki update после Quality включён в исходно запрошенный workflow.
- Commit, staging, push, deploy, migration application и secret access всегда
  требуют отдельных разрешений.
