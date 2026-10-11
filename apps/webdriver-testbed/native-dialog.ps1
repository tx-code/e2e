param([string]$ResultPath,[string]$InitialDirectory,[switch]$Classic,[switch]$ErrorDialog,[switch]$SaveDialog,[switch]$SaveAfterOpen)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
if ($ErrorDialog) {
  $result = [System.Windows.Forms.MessageBox]::Show('Neutral native failure marker', 'Fixture error', [System.Windows.Forms.MessageBoxButtons]::OK)
  @{result=$result.ToString();file=''} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultPath -Encoding UTF8
  exit 0
}
$dialog = if($SaveDialog){[System.Windows.Forms.SaveFileDialog]::new()}else{[System.Windows.Forms.OpenFileDialog]::new()}
$dialog.Title = 'Select test fixture'
$dialog.InitialDirectory = $InitialDirectory
$dialog.AutoUpgradeEnabled = -not $Classic
$dialog.Filter = 'Text files (*.txt)|*.txt|All files (*.*)|*.*'
$dialog.CheckFileExists = -not $SaveDialog
if($SaveDialog){$dialog.OverwritePrompt=$true;$dialog.DefaultExt='txt'}
$result = $dialog.ShowDialog()
if($SaveAfterOpen -and $result -eq [System.Windows.Forms.DialogResult]::OK) {
  $openedFile = $dialog.FileName
  $dialog.Dispose()
  $save = [System.Windows.Forms.SaveFileDialog]::new()
  $save.Title = 'Save selected fixture'
  $save.InitialDirectory = $InitialDirectory
  $save.AutoUpgradeEnabled = -not $Classic
  $save.Filter = 'Text files (*.txt)|*.txt'
  $save.DefaultExt = 'txt'
  $save.OverwritePrompt = $true
  $savedResult = $save.ShowDialog()
  if($savedResult -eq [System.Windows.Forms.DialogResult]::OK){[System.IO.File]::WriteAllText($save.FileName,[System.IO.File]::ReadAllText($openedFile))}
  @{result=$savedResult.ToString();file=$openedFile;savedFile=$save.FileName} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultPath -Encoding UTF8
  $save.Dispose()
  exit 0
}
if($SaveDialog -and $result -eq [System.Windows.Forms.DialogResult]::OK){[System.IO.File]::WriteAllText($dialog.FileName,'Saved neutral fixture content.')}
@{result=$result.ToString();file=$dialog.FileName} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultPath -Encoding UTF8
$dialog.Dispose()
