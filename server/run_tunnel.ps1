while ($true) {
    Write-Host "Starting localhost.run tunnel on port 8000..."
    ssh -o StrictHostKeyChecking=no -R 80:127.0.0.1:8000 nokey@localhost.run
    Write-Host "Tunnel disconnected. Reconnecting in 5 seconds..."
    Start-Sleep -Seconds 5
}
