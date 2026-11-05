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

Upload-FtpFile "public_html/sskgecc/index.html" "$root\index.html"
Upload-FtpFile "public_html/sskgecc/assets/public-features.css" "$root\assets\public-features.css"

Write-Host "DEPLOYMENT OF MENTOR PHONES COMPLETE!"
