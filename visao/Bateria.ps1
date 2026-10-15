$py = ".\.venv\Scripts\python.exe"
New-Item -ItemType Directory -Force pesos\bateria | Out-Null
$csv = "bateria-resultados.csv"
if (-not (Test-Path $csv)) {
  "config,repeticao,val_erro,val_vies,teste_erro,teste_vies" | Out-File $csv -Encoding utf8
}

$configs = @(
  @{ nome = "base60";    args = @("--epocas","60") },
  @{ nome = "pesos10";   args = @("--epocas","60","--expoente-dos-pesos","1.0") },
  @{ nome = "pesos10lr"; args = @("--epocas","60","--expoente-dos-pesos","1.0","--taxa","0.0003") },
  @{ nome = "resnet18";  args = @("--epocas","40","--arquitetura","unet-resnet18","--taxa","0.0003") }
)

function Valor($linhas, $rotulo) {
  foreach ($l in $linhas) {
    if ($l -match "$rotulo.*:\s*([-+]?[0-9.]+)%") { return $Matches[1] }
  }
  return ""
}

foreach ($c in $configs) {
  foreach ($rep in 1..3) {
    $nome = "$($c.nome)-r$rep"
    $pt   = "pesos\bateria\$nome.pt"
    $fim  = "pesos\bateria\$nome.historico.json"
    if (Test-Path $fim) { continue }   # ja concluida: permite retomar

    Write-Host "=== $nome ($(Get-Date -Format HH:mm)) ==="
    & $py treino\treinar.py @($c.args) --lote 4 --versao "bat-$nome" --saida $pt 2>&1 |
      Tee-Object "pesos\bateria\$nome.log" | Out-Null

    $v = & $py treino\avaliar_modelo.py --pesos $pt --divisao validacao 2>&1 | ForEach-Object { "$_" }
    $t = & $py treino\avaliar_modelo.py --pesos $pt --divisao teste 2>&1 | ForEach-Object { "$_" }
    $linha = "$($c.nome),$rep,$(Valor $v 'Erro absoluto medio'),$(Valor $v 'Vies'),$(Valor $t 'Erro absoluto medio'),$(Valor $t 'Vies')"
    $linha | Add-Content $csv
    Write-Host $linha
  }
}
Write-Host "Fim da bateria: $(Get-Date -Format HH:mm)"