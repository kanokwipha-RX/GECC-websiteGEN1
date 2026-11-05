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

# 1. Upload mentor images
Upload-FtpFile "public_html/sskgecc/assets/images/mentor-group-3-2.jpg" "$root\assets\images\mentor-group-3-2.jpg"
Upload-FtpFile "public_html/sskgecc/assets/images/mentor-group-3-3.jpg" "$root\assets\images\mentor-group-3-3.jpg"
Upload-FtpFile "public_html/sskgecc/assets/images/mentor-group-4-2.jpg" "$root\assets\images\mentor-group-4-2.jpg"
Upload-FtpFile "public_html/sskgecc/assets/images/mentor-group-4-3.jpg" "$root\assets\images\mentor-group-4-3.jpg"

# 2. Upload migration script & execute
Upload-FtpFile "public_html/sskgecc/update_mentor_photos.php" "$root\tools\update_mentor_photos.php"
Start-Sleep -Seconds 1
Write-Host "Triggering update_mentor_photos.php via HTTPS..."
$res = Invoke-RestMethod -Uri "https://www.osscsskfda.org/sskgecc/update_mentor_photos.php" -Method Get
Write-Host "Migration result:" ($res | ConvertTo-Json -Depth 3)
Remove-FtpFile "public_html/sskgecc/update_mentor_photos.php"

# 3. Build & upload index.html
Write-Host "Uploading index.html..."
Upload-FtpFile "public_html/sskgecc/index.html" "$root\index.html"

# 4. Verify remote public/login-options
Write-Host "Verifying remote login-options..."
$opts = Invoke-RestMethod -Uri "https://www.osscsskfda.org/sskgecc/api/index.php?route=public/login-options"
$opts.mentors | Where-Object { $_.team -eq 3 -or $_.team -eq 4 } | ForEach-Object {
    [PSCustomObject]@{
        team = $_.team
        name = $_.name
        photo = $_.photo
        username = $_.username
    }
} | Format-Table -AutoSize

Write-Host "DEPLOYMENT OF MENTOR PHOTOS COMPLETE!"
