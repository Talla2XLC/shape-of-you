[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$WikiRoot = Join-Path $RepositoryRoot 'docs\wiki'
$AdrRoot = Join-Path $RepositoryRoot 'docs\adr'
$TemplateRoot = Join-Path $RepositoryRoot 'docs\templates'
$Errors = [System.Collections.Generic.List[string]]::new()
$Ids = @{}
$Utf8 = [System.Text.UTF8Encoding]::new($false, $true)

$WikiKinds = @('start', 'vision', 'product', 'domain', 'data', 'architecture', 'roadmap')
$WikiStatuses = @('draft', 'accepted', 'deprecated')
$AdrStatuses = @('proposed', 'accepted', 'superseded', 'rejected')
$WikiSections = @('Кратко', 'Содержание', 'Основания', 'Решения', 'Открытые вопросы', 'Связанные материалы')
$AdrSections = @('Контекст', 'Решение', 'Рассмотренные альтернативы', 'Последствия', 'Проверка', 'Связанные материалы')

function Add-Violation {
    param(
        [string]$Path,
        [string]$Message
    )

    $displayPath = $Path
    if ($Path.StartsWith($RepositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $displayPath = $Path.Substring($RepositoryRoot.Length).TrimStart('\', '/')
    }
    $Errors.Add(('{0}: {1}' -f $displayPath, $Message))
}

function Read-Utf8File {
    param([string]$Path)

    try {
        return $Utf8.GetString([System.IO.File]::ReadAllBytes($Path))
    }
    catch {
        Add-Violation $Path 'файл не является корректным UTF-8'
        return $null
    }
}

function Read-Frontmatter {
    param(
        [string]$Path,
        [string]$Text
    )

    $lines = $Text -split '\r?\n'
    if ($lines.Count -lt 3 -or $lines[0] -ne '---') {
        Add-Violation $Path 'отсутствует YAML frontmatter'
        return $null
    }

    $closing = -1
    for ($i = 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -eq '---') {
            $closing = $i
            break
        }
    }
    if ($closing -lt 0) {
        Add-Violation $Path 'YAML frontmatter не закрыт'
        return $null
    }

    $metadata = @{}
    for ($i = 1; $i -lt $closing; $i++) {
        if ($lines[$i] -match '^([a-z][a-z0-9_]*):\s*(.*)$') {
            $key = $Matches[1]
            $value = $Matches[2].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $metadata[$key] = $value
        }
    }

    return $metadata
}

function Test-RequiredMetadata {
    param(
        [string]$Path,
        [hashtable]$Metadata,
        [string[]]$Keys
    )

    foreach ($key in $Keys) {
        $missing = -not $Metadata.ContainsKey($key)
        if (-not $missing -and $key -ne 'tags') {
            $missing = [string]::IsNullOrWhiteSpace($Metadata[$key])
        }
        if ($missing) {
            Add-Violation $Path ("отсутствует обязательное поле frontmatter '{0}'" -f $key)
        }
    }
}

function Test-Sections {
    param(
        [string]$Path,
        [string]$Text,
        [string[]]$Sections
    )

    foreach ($section in $Sections) {
        $escaped = [regex]::Escape($section)
        $match = [regex]::Match(
            $Text,
            "(?ms)^## $escaped\s*\r?\n(.*?)(?=^## |\z)"
        )
        if (-not $match.Success) {
            Add-Violation $Path ("отсутствует обязательный раздел '## {0}'" -f $section)
        }
        elseif ([string]::IsNullOrWhiteSpace($match.Groups[1].Value)) {
            Add-Violation $Path ("раздел '## {0}' пуст; добавьте содержимое или явное указание «Не применимо»" -f $section)
        }
    }
}

function Test-Links {
    param(
        [string]$Path,
        [string]$Text
    )

    $matches = [regex]::Matches($Text, '(?m)!?\[[^\]]*\]\(([^)]+)\)')
    foreach ($match in $matches) {
        $target = $match.Groups[1].Value.Trim()
        if ($target.StartsWith('<') -and $target.EndsWith('>')) {
            $target = $target.Substring(1, $target.Length - 2)
        }
        elseif ($target -match "^(\S+)(?:\s+[`"'].*[`"'])$") {
            $target = $Matches[1]
        }

        if ($target -match '^(?i:https?|mailto):' -or $target.StartsWith('#')) {
            continue
        }
        if ($target -match '^[A-Za-z]:[\\/]' -or $target.StartsWith('/') -or $target.StartsWith('\')) {
            Add-Violation $Path ("локальная ссылка должна быть относительной: {0}" -f $target)
            continue
        }

        $pathPart = ($target -split '#', 2)[0]
        if ([string]::IsNullOrWhiteSpace($pathPart)) {
            continue
        }
        $decoded = [System.Uri]::UnescapeDataString($pathPart)
        $resolved = [System.IO.Path]::GetFullPath((Join-Path (Split-Path $Path) $decoded))
        if (-not $resolved.StartsWith($RepositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            Add-Violation $Path ("относительная ссылка выходит за пределы репозитория: {0}" -f $target)
            continue
        }
        if (-not (Test-Path -LiteralPath $resolved)) {
            Add-Violation $Path ("цель относительной ссылки не существует: {0}" -f $target)
        }
        if ($decoded -match '(?i)(^|[\\/])\.env($|[./\\])|\.pem$|\.key$|\.pfx$|\.p12$|\.sql(?:ite3?)?$|\.dump$') {
            Add-Violation $Path ("ссылка ведёт на запрещённый чувствительный файл: {0}" -f $target)
        }
    }
}

function Test-ContentSafety {
    param(
        [string]$Path,
        [string]$Text
    )

    if ($Text -match '(?m)^(<<<<<<<|=======|>>>>>>>)') {
        Add-Violation $Path 'обнаружен неразрешённый marker конфликта слияния'
    }
    if ($Text -match '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----') {
        Add-Violation $Path 'обнаружен блок private key'
    }
    if ($Text -match "(?im)^\s*(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*[`"']?[A-Za-z0-9_\-+/=]{12,}") {
        Add-Violation $Path 'обнаружено значение, похожее на credentials'
    }
}

foreach ($requiredDirectory in @($WikiRoot, $AdrRoot, $TemplateRoot)) {
    if (-not (Test-Path -LiteralPath $requiredDirectory -PathType Container)) {
        Add-Violation $requiredDirectory 'отсутствует обязательный каталог'
    }
}

$wikiFiles = @()
$adrFiles = @()
if (Test-Path -LiteralPath $WikiRoot) {
    $wikiFiles = @(Get-ChildItem -LiteralPath $WikiRoot -Recurse -File -Filter '*.md' | Sort-Object FullName)
}
if (Test-Path -LiteralPath $AdrRoot) {
    $adrFiles = @(Get-ChildItem -LiteralPath $AdrRoot -Recurse -File -Filter '*.md' | Sort-Object FullName)
}
if ($wikiFiles.Count -eq 0) {
    Add-Violation $WikiRoot 'страницы Wiki не найдены'
}
if ($adrFiles.Count -eq 0) {
    Add-Violation $AdrRoot 'файлы ADR не найдены'
}

foreach ($file in @($wikiFiles + $adrFiles)) {
    $text = Read-Utf8File $file.FullName
    if ($null -eq $text) {
        continue
    }

    Test-ContentSafety $file.FullName $text
    Test-Links $file.FullName $text
    $metadata = Read-Frontmatter $file.FullName $text
    if ($null -eq $metadata) {
        continue
    }

    Test-RequiredMetadata $file.FullName $metadata @('id', 'kind', 'title', 'status', 'tags')
    if ($metadata.ContainsKey('id') -and -not [string]::IsNullOrWhiteSpace($metadata['id'])) {
        $id = $metadata['id']
        if ($Ids.ContainsKey($id)) {
            Add-Violation $file.FullName ("identifier '{0}' уже используется в {1}" -f $id, $Ids[$id])
        }
        else {
            $Ids[$id] = $file.FullName.Substring($RepositoryRoot.Length).TrimStart('\', '/')
        }
    }

    $isAdr = $file.FullName.StartsWith($AdrRoot, [System.StringComparison]::OrdinalIgnoreCase)
    if ($isAdr) {
        Test-RequiredMetadata $file.FullName $metadata @('date', 'supersedes', 'superseded_by')
        if ($metadata.ContainsKey('kind') -and $metadata['kind'] -ne 'adr') {
            Add-Violation $file.FullName "ADR должен иметь kind: adr"
        }
        if ($metadata.ContainsKey('status') -and $metadata['status'] -notin $AdrStatuses) {
            Add-Violation $file.FullName ("недопустимый status ADR: {0}" -f $metadata['status'])
        }
        if ($file.Name -notmatch '^(\d{8})-[a-z0-9-]+\.md$') {
            Add-Violation $file.FullName 'имя файла ADR должно соответствовать YYYYMMDD-kebab-case.md'
        }
        elseif ($metadata.ContainsKey('date')) {
            $expectedDate = '{0}-{1}-{2}' -f $Matches[1].Substring(0, 4), $Matches[1].Substring(4, 2), $Matches[1].Substring(6, 2)
            if ($metadata['date'] -ne $expectedDate) {
                Add-Violation $file.FullName ("date '{0}' не соответствует префиксу имени файла" -f $metadata['date'])
            }
        }
        Test-Sections $file.FullName $text $AdrSections
    }
    else {
        if ($metadata.ContainsKey('kind') -and $metadata['kind'] -notin $WikiKinds) {
            Add-Violation $file.FullName ("недопустимый kind Wiki: {0}" -f $metadata['kind'])
        }
        if ($metadata.ContainsKey('status') -and $metadata['status'] -notin $WikiStatuses) {
            Add-Violation $file.FullName ("недопустимый status Wiki: {0}" -f $metadata['status'])
        }
        Test-Sections $file.FullName $text $WikiSections
    }
}

$managedExportRoot = Join-Path $RepositoryRoot '.4dt\wiki\pages'
if (Test-Path -LiteralPath $managedExportRoot) {
    foreach ($file in Get-ChildItem -LiteralPath $managedExportRoot -Recurse -File -Filter '*.md') {
        Add-Violation $file.FullName 'обнаружен Markdown managed Wiki вне канонических путей'
    }
}

$canonicalPrefixes = @(
    ($WikiRoot + [System.IO.Path]::DirectorySeparatorChar),
    ($AdrRoot + [System.IO.Path]::DirectorySeparatorChar)
)
foreach ($file in Get-ChildItem -LiteralPath $RepositoryRoot -Recurse -File -Filter '*.md') {
    $isCanonical = $false
    foreach ($prefix in $canonicalPrefixes) {
        if ($file.FullName.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $isCanonical = $true
            break
        }
    }
    if ($isCanonical -or $file.FullName.StartsWith($TemplateRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        continue
    }
    $text = Read-Utf8File $file.FullName
    if ($null -ne $text -and $text -match '(?ms)^---\s.*?^owner:\s*wiki\s*$.*?^---\s*$') {
        Add-Violation $file.FullName 'обнаружен frontmatter managed Wiki вне канонических путей'
    }
}

if ($Errors.Count -gt 0) {
    Write-Host ("Проверка документации завершилась ошибкой: нарушений — {0}." -f $Errors.Count) -ForegroundColor Red
    foreach ($violation in $Errors | Sort-Object) {
        Write-Host ("- {0}" -f $violation)
    }
    exit 1
}

Write-Host ("Проверка документации пройдена: страниц Wiki — {0}, ADR — {1}, уникальных id — {2}." -f $wikiFiles.Count, $adrFiles.Count, $Ids.Count) -ForegroundColor Green
exit 0
