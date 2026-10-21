Add-Type -AssemblyName System.Drawing
foreach ($size in @(16,48,128)) {
  $bitmap = [System.Drawing.Bitmap]::new($size,$size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = 'AntiAlias'
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#355a45'))
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#e6eedc'),[single]($size * 0.06))
  $graphics.DrawArc($pen,[single]($size*0.34),[single]($size*0.2),[single]($size*0.32),[single]($size*0.42),180,180)
  $graphics.DrawRectangle($pen,[single]($size*0.25),[single]($size*0.43),[single]($size*0.5),[single]($size*0.37))
  $graphics.DrawLine($pen,[single]($size*0.5),[single]($size*0.55),[single]($size*0.5),[single]($size*0.68))
  $bitmap.Save((Join-Path $PSScriptRoot "../public/icons/icon$size.png"),[System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
