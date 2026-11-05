[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ftpHost = '27.254.62.185:2121'
$user = 'osscsskf'
$pass = '951nFxJ2d*)pJC'
$root = 'c:\Users\USER\Downloads\GECC'

function Upload-FtpFile($remoteRelPath, $localFilePath) {
    $remoteUri = "ftp://$ftpHost/$remoteRelPath"
    Write-Host "Uploading $localFilePath -> $remoteUri"
    $req = [System.Net.FtpWebRequest]::Create($remoteUri)
    $req.Method = [System.Net.WebRequestMethods+Ftp]::UploadFile
    $req.Credentials = New-Object System.Net.NetworkCredential($user, $pass)
    $req.UseBinary = $true
    $req.KeepAlive = $false
    $bytes = [System.IO.File]::ReadAllBytes($localFilePath)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $resp = $req.GetResponse()
    Write-Host "Uploaded: $($resp.StatusDescription.Trim())"
    $resp.Close()
}

function Remove-FtpFile($remoteRelPath) {
    $remoteUri = "ftp://$ftpHost/$remoteRelPath"
    Write-Host "Deleting $remoteUri"
    $req = [System.Net.FtpWebRequest]::Create($remoteUri)
    $req.Method = [System.Net.WebRequestMethods+Ftp]::DeleteFile
    $req.Credentials = New-Object System.Net.NetworkCredential($user, $pass)
    $req.KeepAlive = $false
    try {
        $resp = $req.GetResponse()
        Write-Host "Deleted: $($resp.StatusDescription.Trim())"
        $resp.Close()
    } catch {
        Write-Warning "Could not delete: $_"
    }
}

# 1. Upload committee image
Upload-FtpFile "public_html/sskgecc/assets/images/committee-08.jpg" "$root\assets\images\committee-08.jpg"

# 2. Upload migration script & execute
Upload-FtpFile "public_html/sskgecc/update_committee_photos.php" "$root\tools\update_committee_photos.php"
Start-Sleep -Seconds 1
Write-Host "Triggering update_committee_photos.php via HTTPS..."
$res = Invoke-RestMethod -Uri "https://www.osscsskfda.org/sskgecc/update_committee_photos.php" -Method Get
Write-Host "Migration result:" ($res | ConvertTo-Json -Depth 3)
Remove-FtpFile "public_html/sskgecc/update_committee_photos.php"

# 3. Build & upload index.html
Write-Host "Uploading index.html..."
Upload-FtpFile "public_html/sskgecc/index.html" "$root\index.html"

# 4. Verify remote public/content
Write-Host "Verifying remote committee photo..."
$content = Invoke-RestMethod -Uri "https://www.osscsskfda.org/sskgecc/api/index.php?route=public/content"
$c8 = $content.committee | Where-Object { $_.photo -like '*committee-08*' }
Write-Host "Remote committee-08: " ($c8 | ConvertTo-Json -Depth 2)

Write-Host "DEPLOYMENT OF COMMITTEE 08 COMPLETE!"
