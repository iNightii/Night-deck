using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace NightDeck;

internal static class AutoUpdater
{
    private const string Repo = "iNightii/Night-deck";
    private const string Artifact = "Night-Deck-Windows-x64";
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
            var (status, json) = await RunGhAsync("run", "list", "-R", Repo, "--workflow", "build.yml",
                "--json", "databaseId,conclusion", "--limit", "15");
            if (status != 0)
            {
                if (manual) MessageBox.Show("Para atualizar pelo repositorio privado, instale GitHub CLI e execute 'gh auth login' uma vez.\n\n" + json, "Atualizacoes");
                return;
            }
            using var document = JsonDocument.Parse(json);
            long newest = 0;
            foreach (var run in document.RootElement.EnumerateArray())
            {
                if (run.GetProperty("conclusion").GetString() != "success") continue;
                long id = run.GetProperty("databaseId").GetInt64();
                if (id > newest) newest = id;
            }
            if (newest == 0 || newest <= current)
            {
                if (manual) MessageBox.Show("Voce ja esta na versao mais recente.", "Atualizacoes");
                return;
            }
            string stage = Path.Combine(Path.GetTempPath(), "NightDeck-update-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stage);
            var (downloadStatus, details) = await RunGhAsync("run", "download", newest.ToString(),
                "-R", Repo, "-n", Artifact, "-D", stage);
            if (downloadStatus != 0)
            {
                if (manual) MessageBox.Show("Nao foi possivel baixar a atualizacao:\n" + details, "Atualizacoes");
                return;
            }
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

    private static async Task<(int code, string output)> RunGhAsync(params string[] args)
    {
        var start = new ProcessStartInfo("gh")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        foreach (var arg in args) start.ArgumentList.Add(arg);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("GitHub CLI indisponivel.");
        var outputTask = process.StandardOutput.ReadToEndAsync();
        var errorTask = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        var output = await outputTask;
        var error = await errorTask;
        return (process.ExitCode, process.ExitCode == 0 ? output : error);
    }
}
