# Список стикеров для админки: assets/stickers/index.json
#
# Браузер не умеет читать папку на диске, поэтому перечень файлов пишем сюда —
# по нему админка находит новые картинки и заводит их одной кнопкой.
#
# ВНИМАНИЕ, ИМЕНА ЧИНИМ ЗДЕСЬ. Имя файла становится КЛЮЧОМ стикера и уходит в
# ссылку, а картинки приходят с именами вроде
# "Gemini_Generated_Image_p5s6 (1).jpg" — с пробелами, скобками и кириллицей.
# Ругаться на это бессмысленно (человек не переименовывает три десятка файлов
# руками), поэтому переименовываем сами: транслит + латиница/цифры/дефис.
param([string]$Dir)

$ok = '.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg'
$tr = @{
  'а'='a';'б'='b';'в'='v';'г'='g';'д'='d';'е'='e';'ё'='e';'ж'='zh';'з'='z';'и'='i';
  'й'='y';'к'='k';'л'='l';'м'='m';'н'='n';'о'='o';'п'='p';'р'='r';'с'='s';'т'='t';
  'у'='u';'ф'='f';'х'='h';'ц'='c';'ч'='ch';'ш'='sh';'щ'='sch';'ъ'='';'ы'='y';'ь'='';
  'э'='e';'ю'='yu';'я'='ya'
}
function To-Key([string]$name) {
  $s = $name.ToLower()
  $sb = New-Object Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    $c = [string]$ch
    if ($tr.ContainsKey($c)) { [void]$sb.Append($tr[$c]) }
    elseif ($c -match '[a-z0-9]') { [void]$sb.Append($c) }
    else { [void]$sb.Append('-') }
  }
  $out = $sb.ToString() -replace '-+', '-'
  $out = $out.Trim('-')
  if ($out.Length -gt 40) { $out = $out.Substring(0, 40).Trim('-') }
  if ($out.Length -lt 2) { $out = 'sticker' }
  return $out
}

# 1. Чиним имена
$renamed = 0
foreach ($f in @(Get-ChildItem -LiteralPath $Dir -File | Where-Object { $ok -contains $_.Extension.ToLower() })) {
  $key = To-Key $f.BaseName
  $ext = $f.Extension.ToLower()
  if ($key -eq $f.BaseName -and $ext -eq $f.Extension) { continue }
  # Занято — добавляем номер, чужой стикер затирать нельзя.
  $try = $key; $n = 2
  while (Test-Path -LiteralPath (Join-Path $Dir ($try + $ext))) { $try = "$key-$n"; $n++ }
  Rename-Item -LiteralPath $f.FullName -NewName ($try + $ext)
  Write-Host ("   pereimenovan: " + $f.Name + " -> " + $try + $ext)
  $renamed++
}

# 2. Пишем список
$files = Get-ChildItem -LiteralPath $Dir -File | Where-Object { $ok -contains $_.Extension.ToLower() }
$list = @($files | ForEach-Object {
  [pscustomobject]@{ key = $_.BaseName; ext = $_.Extension.TrimStart('.').ToLower() }
})
# ConvertTo-Json на одном элементе отдаёт объект, а не массив — оборачиваем сами.
$json = if ($list.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $list -Compress -Depth 3 }
if (-not $json.StartsWith('[')) { $json = '[' + $json + ']' }
$out = Join-Path -Path (Resolve-Path -LiteralPath $Dir).Path -ChildPath 'index.json'
[IO.File]::WriteAllText($out, $json, (New-Object Text.UTF8Encoding($false)))
Write-Host ("   Stikerov v papke: " + $list.Count)
