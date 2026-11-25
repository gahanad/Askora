
# ==========================================
# ASKORA - REDIS DISTRIBUTED LOCK TEST
# ==========================================

$baseUrl = "http://localhost:3000"

# Replace these with valid values from your application.
$eventId="6afc126c00103f90b72b"
$jwt="eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJwcm9qZWN0SWQiOiI2YWQ3ZDliNzAwMTVlODM4NmRhMiIsInVzZXJJZCI6IjZhZDkyZDk0MDAzOTcwZDQwNjU3Iiwic2Vzc2lvbklkIjoiNmFkOTMzMTA1MGUxZmRkZTg0ZmIiLCJleHAiOjE3OTUyOTM4Mzd9.ngBV1durDAU9SJCNN4nfVxwCKvTiD2vpsLUf2Y5wexY"

# All requests submit exactly the same question.
$question = "Which day is tomorrow?"

# Number of simultaneous requests.
$requestCount = 5

Write-Host "`nStarting Redis concurrency test..." -ForegroundColor Cyan
Write-Host "Event ID: $eventId"
Write-Host "Question: $question"
Write-Host "Requests: $requestCount`n"

$jobs = @()

# Launch all requests concurrently.
for ($i = 1; $i -le $requestCount; $i++) {

    $jobs += Start-Job -ArgumentList @(
        $baseUrl,
        $eventId,
        $jwt,
        $question,
        $i
    ) -ScriptBlock {

        param($baseUrl, $eventId, $jwt, $question, $index)

        $body = @{
            eventId = $eventId
            text    = $question
        } | ConvertTo-Json

        $headers = @{
            Authorization = "Bearer $jwt"
            "Content-Type" = "application/json"
            "Idempotency-Key" = [guid]::NewGuid().ToString()
        }

        $start = Get-Date

        try {
            $response = Invoke-RestMethod `
                -Uri "$baseUrl/api/questions" `
                -Method POST `
                -Headers $headers `
                -Body $body

            $duration = ((Get-Date) - $start).TotalSeconds

            [PSCustomObject]@{
                Request      = $index
                Success      = $response.success
                QuestionId   = $response.questionId
                ClusterId    = $response.clusterId
                Matched      = $response.matchedExistingCluster
                Similarity   = $response.similarity
                DurationSecs = [math]::Round($duration, 2)
                Error        = ""
            }
        }
        catch {
            [PSCustomObject]@{
                Request      = $index
                Success      = $false
                QuestionId   = ""
                ClusterId    = ""
                Matched      = ""
                Similarity   = ""
                DurationSecs = ""
                Error        = $_.Exception.Message
            }
        }
    }
}

# Wait for all requests to finish.
Write-Host "Waiting for requests..." -ForegroundColor Yellow

$jobs | Wait-Job | Out-Null

# Collect results.
$results = $jobs | Receive-Job

# Clean up background jobs.
$jobs | Remove-Job

Write-Host "`n========== RESULTS ==========" -ForegroundColor Cyan

$results | Sort-Object Request | Format-Table -AutoSize

# Calculate summary.
$successful = @($results | Where-Object { $_.Success -eq $true })
$uniqueClusters = @(
    $successful |
    Select-Object -ExpandProperty ClusterId -Unique
)

Write-Host "`n========== SUMMARY ==========" -ForegroundColor Cyan

Write-Host "Total requests: $requestCount"
Write-Host "Successful requests: $($successful.Count)"
Write-Host "Failed requests: $($requestCount - $successful.Count)"
Write-Host "Unique cluster IDs: $($uniqueClusters.Count)"

if ($uniqueClusters.Count -eq 1 -and $successful.Count -eq $requestCount) {
    Write-Host "`nPASS: All requests joined the same cluster." -ForegroundColor Green
}
else {
    Write-Host "`nCHECK: Unexpected cluster distribution." -ForegroundColor Red
}
