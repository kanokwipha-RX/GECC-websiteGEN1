[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ftpHost = '27.254.62.221:2121'
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
    $req = [System.Net.FtpWebRequest]::Create($remoteUri)
    $req.Method = [System.Net.WebRequestMethods+Ftp]::DeleteFile
    $req.Credentials = New-Object System.Net.NetworkCredential($user, $pass)
    $req.KeepAlive = $false
    try {
        $resp = $req.GetResponse()
        $resp.Close()
    } catch {}
}

# 1. Update policy.php on server
Write-Host "Uploading policy payload and updater..."
Upload-FtpFile "public_html/sskgecc/policy_payload.txt" "$root\php\policy.php"
Upload-FtpFile "public_html/sskgecc/update_server_policy.php" "$root\tools\update_server_policy.php"
Start-Sleep -Seconds 1

Write-Host "Executing update_server_policy.php via HTTPS..."
$res = Invoke-RestMethod -Uri "https://www.osscsskfda.org/sskgecc/update_server_policy.php" -Method Get
Write-Host "Server policy update:" ($res | ConvertTo-Json -Depth 3)

Remove-FtpFile "public_html/sskgecc/policy_payload.txt"
Remove-FtpFile "public_html/sskgecc/update_server_policy.php"

# 2. Upload assets/server-client.js
Write-Host "Uploading server-client.js..."
Upload-FtpFile "public_html/sskgecc/assets/server-client.js" "$root\assets\server-client.js"

# 3. Upload index.html
Write-Host "Uploading index.html..."
Upload-FtpFile "public_html/sskgecc/index.html" "$root\index.html"

Write-Host "Deployment completed successfully!"
