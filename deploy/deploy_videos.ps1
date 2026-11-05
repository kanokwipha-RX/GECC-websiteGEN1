[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ftpHost = '27.254.62.185:2121'
$user = 'osscsskf'
$pass = '951nFxJ2d*)pJC'
$root = 'c:\Users\USER\Downloads\GECC'

function Ensure-FtpDir($remoteRelPath) {
    $remoteUri = "ftp://$ftpHost/$remoteRelPath"
    try {
        $req = [System.Net.FtpWebRequest]::Create($remoteUri)
        $req.Method = [System.Net.WebRequestMethods+Ftp]::MakeDirectory
        $req.Credentials = New-Object System.Net.NetworkCredential($user, $pass)
        $req.UseBinary = $true
        $req.KeepAlive = $false
        $resp = $req.GetResponse()
        Write-Host "Created FTP dir: $remoteRelPath"
        $resp.Close()
    } catch {
        # Directory might already exist, ignore error
    }
}

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

# 1. Upload updated HTML and assets
Upload-FtpFile "public_html/sskgecc/index.html" "$root\index.html"
Upload-FtpFile "public_html/sskgecc/assets/public-features.css" "$root\assets\public-features.css"
Upload-FtpFile "public_html/sskgecc/assets/public-features.js" "$root\assets\public-features.js"

# 2. Ensure assets/videos dir on FTP
Ensure-FtpDir "public_html/sskgecc/assets/videos"

# 3. Upload the 2 video files
Upload-FtpFile "public_html/sskgecc/assets/videos/gecc-pea-sisaket.mp4" "$root\assets\videos\gecc-pea-sisaket.mp4"
Upload-FtpFile "public_html/sskgecc/assets/videos/gecc-damrongtham-sisaket.mp4" "$root\assets\videos\gecc-damrongtham-sisaket.mp4"

Write-Host "DEPLOYMENT OF VIDEOS COMPLETE!"
