using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;

namespace NightDeck;

internal static class AutoUpdater
{
    private const string Repo = "iNightii/Night-deck";
    private const string Artifact = "Night-Deck-Windows-x64.zip";
    private static readonly HttpClient client = CreateClient();

    private static HttpClient CreateClient()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("NightDeck", "1.0"));
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        return http;
    }
    private static bool checking;

    public static async Task CheckAsync(Form window, bool manual = false)
    {
        if (checking) return;
        checking = true;
        try
        {
            var install = AppContext.BaseDirectory;
            var currentText = File.Exists(Path.Combine(install, "build-id.txt"))
                ? File.ReadAllText(Path.Combine(install, "build-id.txt")).Trim() : "0";
            if (!long.TryParse(currentText, out var current)) current = 0;
            string json = await client.GetStringAsync("https://api.github.com/repos/" + Repo + "/releases/latest");
            using var document = JsonDocument.Parse(json);
            string tag = document.RootElement.GetProperty("tag_name").GetString() ?? "";
            if (!tag.StartsWith("build-", StringComparison.Ordinal) ||
                !long.TryParse(tag.AsSpan(6), out long newest))
                throw new InvalidDataException("Release sem numero de compilacao valido.");
            if (newest <= current)
            {
                if (manual) MessageBox.Show("Voce ja esta na versao mais recente.", "Atualizacoes");
                return;
            }
            string? downloadUrl = null;
            foreach (var asset in document.RootElement.GetProperty("assets").EnumerateArray())
                if (asset.GetProperty("name").GetString() == Artifact)
                    downloadUrl = asset.GetProperty("browser_download_url").GetString();
            if (downloadUrl == null ||
                !Uri.TryCreate(downloadUrl, UriKind.Absolute, out var downloadUri) ||
                downloadUri.Scheme != Uri.UriSchemeHttps ||
                !downloadUri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Arquivo de atualizacao indisponivel ou endereco invalido.");
            string stage = Path.Combine(Path.GetTempPath(), "NightDeck-update-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stage);
            string archive = Path.Combine(stage, "download.zip");
            using (var response = await client.GetAsync(downloadUri, HttpCompletionOption.ResponseHeadersRead))
            {
                response.EnsureSuccessStatusCode();
                await using var remote = await response.Content.ReadAsStreamAsync();
                await using var local = File.Create(archive);
                await remote.CopyToAsync(local);
            }
            string extracted = Path.Combine(stage, "package");
            Directory.CreateDirectory(extracted);
            ZipFile.ExtractToDirectory(archive, extracted);
            stage = extracted;
            string executable = Path.Combine(stage, "NightDeck.exe");
            string sums = Path.Combine(stage, "SHA256SUMS.txt");
            string buildId = Path.Combine(stage, "build-id.txt");
            if (!File.Exists(executable) || !File.Exists(sums) || !File.Exists(buildId))
                throw new InvalidDataException("Pacote de atualizacao incompleto.");
            if (File.ReadAllText(buildId).Trim() != newest.ToString())
                throw new InvalidDataException("Identificador da compilacao nao confere.");
            foreach (string line in File.ReadAllLines(sums))
            {
                var parts = line.Split(new[] { "  " }, 2, StringSplitOptions.None);
                if (parts.Length != 2) throw new InvalidDataException("SHA-256 invalido.");
                string name = parts[1].Trim();
                if (name != Path.GetFileName(name)) throw new InvalidDataException("Caminho inseguro.");
                string file = Path.Combine(stage, name);
                if (!File.Exists(file) || !Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)))
                    .Equals(parts[0], StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Falha na verificacao SHA-256: " + name);
            }
            string script = Path.Combine(stage, "apply-update.ps1");
            File.WriteAllText(script, """
param([int]$AppPid, [string]$Source, [string]$Destination, [string]$Exe)
$ErrorActionPreference = 'Stop'
try {
    Wait-Process -Id $AppPid -Timeout 60 -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 750
    Get-ChildItem -LiteralPath $Source -File | Where-Object { $_.Name -ne 'apply-update.ps1' } |
        Copy-Item -Destination $Destination -Force
    $assets = Join-Path $Source 'assets'
    if (Test-Path $assets) { Copy-Item -LiteralPath $assets -Destination $Destination -Recurse -Force }
    Start-Process -FilePath (Join-Path $Destination $Exe)
} catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Night Deck - Atualizacao') | Out-Null
}
""");
            var start = new ProcessStartInfo("powershell.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = stage
            };
            start.ArgumentList.Add("-NoProfile");
            start.ArgumentList.Add("-ExecutionPolicy");
            start.ArgumentList.Add("Bypass");
            start.ArgumentList.Add("-File");
            start.ArgumentList.Add(script);
            start.ArgumentList.Add("-AppPid");
            start.ArgumentList.Add(Environment.ProcessId.ToString());
            start.ArgumentList.Add("-Source");
            start.ArgumentList.Add(stage);
            start.ArgumentList.Add("-Destination");
            start.ArgumentList.Add(install);
            start.ArgumentList.Add("-Exe");
            start.ArgumentList.Add("NightDeck.exe");
            Process.Start(start);
            window.BeginInvoke(() => window.Close());
        }
        catch (Exception ex)
        {
            if (manual) MessageBox.Show(ex.Message, "Falha na atualizacao");
        }
        finally { checking = false; }
    }

}
