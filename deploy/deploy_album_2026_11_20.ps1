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

# 1. Upload 30 images
Write-Host "1. Uploading 30 gallery photos..."
$photos = Get-ChildItem -Path "$root\assets\gallery\gallery-2026-11-20-*.jpg" | Sort-Object Name
foreach ($p in $photos) {
    Upload-FtpFile "public_html/sskgecc/assets/gallery/$($p.Name)" $p.FullName
}

# 2. Upload assets/public-features.js and index.html
Write-Host "2. Uploading assets/public-features.js..."
Upload-FtpFile "public_html/sskgecc/assets/public-features.js" "$root\assets\public-features.js"

Write-Host "3. Uploading index.html..."
Upload-FtpFile "public_html/sskgecc/index.html" "$root\index.html"

# 4. Upload and execute DB updater
Write-Host "4. Updating database state..."
Upload-FtpFile "public_html/sskgecc/add_album_2026_11_20.php" "$root\tools\add_album_2026_11_20.php"
$res = Invoke-RestMethod -Uri "https://www.osscsskfda.org/sskgecc/add_album_2026_11_20.php"
Write-Host "DB updater response: $res"
Remove-FtpFile "public_html/sskgecc/add_album_2026_11_20.php"

Write-Host "Deployment of Gallery 2026-11-20 completed successfully!"
