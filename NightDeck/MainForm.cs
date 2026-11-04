using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Drawing;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NightDeck;

public sealed class MainForm : Form
{
    private readonly FlowLayoutPanel toolbar = new() { Dock = DockStyle.Top, Height = 42, WrapContents = false, AutoScroll = true, BackColor = Color.FromArgb(17, 24, 39), Padding = new Padding(7, 4, 7, 4) };
    private readonly WebView2 classicToolbar = new() { Dock = DockStyle.Top, Height = 43, DefaultBackgroundColor = Color.FromArgb(17, 24, 39) };
    private readonly TableLayoutPanel grid = new() { Dock = DockStyle.Fill, Margin = Padding.Empty, Padding = Padding.Empty };
    private readonly WebView2[] browsers = new WebView2[4];
    private readonly Panel[] panes = new Panel[4];
    private readonly bool[] visible = { true, true, true, true };
    private readonly int[] zoom = { 90, 90, 90, 90 };
    private readonly bool[] echoTargets = { false, true, true, true };
    private readonly bool[] echoSources = { true, false, false, false };
    private readonly string dataPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PokeIdleMultiscreenCS");
    private readonly string restockScript = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "assets", "recompra.js"));
    private readonly JsonObject[] restock = new JsonObject[4];
    private bool echoEnabled;
    private string layout = "2x2";
    private int? focused;
    private string UiSettingsPath => Path.Combine(dataPath, "ui-settings.json");

    public MainForm()
    {
        Text = "Night Deck";
        Font = new Font("Segoe UI", 9f);
        MinimumSize = new Size(800, 500);
        WindowState = FormWindowState.Maximized;
        BackColor = Color.FromArgb(11, 17, 32);
        Controls.Add(grid);
        Controls.Add(classicToolbar);
        Controls.Add(toolbar);
        toolbar.Visible = false;
        Directory.CreateDirectory(dataPath);
        LoadUiSettings();
        for (int i = 0; i < 4; i++)
        {
            restock[i] = LoadRestock(i);
            CreatePane(i);
        }
        AddButton("▦  2×2", () => { focused = null; layout = "2x2"; Rebuild(); SaveUiSettings(); });
        AddButton("☷  1×4", () => { focused = null; layout = "1x4"; Rebuild(); SaveUiSettings(); });
        AddButton("◉  Contas", () => { for (int i = 0; i < 4; i++) visible[i] = true; focused = null; Rebuild(); SaveUiSettings(); });
        AddButton("⇄  Echo: OFF", ToggleEcho, "echoButton");
        AddButton("⚙  Echo", ConfigureEcho);
        AddButton("🛒  Restock", ConfigureRestock);
        AddButton("⬇  Extensões", ImportExtensions);
        AddButton("⟳  Recarregar", () => { foreach (var b in browsers) b.CoreWebView2?.Reload(); });
        AddButton("⛶  Tela cheia", () => { FormBorderStyle = FormBorderStyle == FormBorderStyle.None ? FormBorderStyle.Sizable : FormBorderStyle.None; WindowState = FormWindowState.Maximized; });
        AddButton("▶  MultiTwitch", () => OpenSite("https://multitwitch.tv/", "MultiTwitch"));
        AddButton("⌕  Onde caçar", () => OpenSite("https://pokeidle-ferramentas.pages.dev/#hunt", "Onde caçar"));
        AddButton("↻  Atualizações", () => _ = AutoUpdater.CheckAsync(this, manual: true));
        Rebuild();
        Shown += async (_, _) => { await InitializeClassicToolbar(); await InitializeBrowsers(); _ = AutoUpdater.CheckAsync(this); };
    }

    private async Task InitializeClassicToolbar()
    {
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: Path.Combine(dataPath, "classic-toolbar"));
            await classicToolbar.EnsureCoreWebView2Async(environment);
            classicToolbar.CoreWebView2.Settings.IsStatusBarEnabled = false;
            classicToolbar.CoreWebView2.Settings.AreDevToolsEnabled = false;
            classicToolbar.CoreWebView2.WebMessageReceived += (_, args) =>
            {
                try
                {
                    using var message = JsonDocument.Parse(args.WebMessageAsJson);
                    if (message.RootElement.ValueKind == JsonValueKind.Number)
                    {
                        int index = message.RootElement.GetInt32();
                        ExecuteToolbarCommand(index);
                    }
                    else if (message.RootElement.ValueKind == JsonValueKind.Object)
                    {
                        var root = message.RootElement;
                        string? kind = root.GetProperty("type").GetString();
                        if (kind == "ready") { UpdateClassicToolbar(); return; }
                        if (kind == "zoom")
                        {
                            int delta = root.GetProperty("delta").GetInt32();
                            int next = delta == 0 ? 100 : Math.Clamp(zoom[0] + delta, 40, 150);
                            for (int i = 0; i < 4; i++)
                            {
                                zoom[i] = next;
                                if (browsers[i].CoreWebView2 != null)
                                    browsers[i].ZoomFactor = next / 100.0;
                            }
                            SaveUiSettings();
                        }
                        else if (kind == "focus" || kind == "visibility")
                        {
                            int i = root.GetProperty("account").GetInt32();
                            if (i < 0 || i >= 4) return;
                            if (kind == "visibility")
                            {
                                visible[i] = !visible[i];
                                if (!visible.Any(v => v)) visible[i] = true;
                                if (focused == i) focused = null;
                            }
                            else if (!visible[i]) { visible[i] = true; focused = null; }
                            else focused = focused == i ? null : i;
                            Rebuild();
                            SaveUiSettings();
                        }
                        UpdateClassicToolbar();
                    }
                }
                catch { }
            };
            string file = Path.Combine(AppContext.BaseDirectory, "assets", "classic-toolbar.html");
            classicToolbar.CoreWebView2.Navigate(new Uri(file).AbsoluteUri);
        }
        catch (Exception ex)
        {
            classicToolbar.Visible = false;
            toolbar.Visible = true;
            MessageBox.Show("Barra classica indisponivel: " + ex.Message, "Night Deck");
        }
    }

    private void ExecuteToolbarCommand(int index)
    {
        // A barra WinForms fica invisivel. PerformClick() em botoes invisiveis
        // nao e confiavel; executar diretamente as acoes do menu HTML.
        switch (index)
        {
            case 0:
                focused = null;
                layout = "2x2";
                Rebuild();
                SaveUiSettings();
                break;
            case 1:
                focused = null;
                layout = "1x4";
                Rebuild();
                SaveUiSettings();
                break;
            case 2:
                Array.Fill(visible, true);
                focused = null;
                Rebuild();
                SaveUiSettings();
                break;
            case 3: ToggleEcho(); break;
            case 4: ConfigureEcho(); break;
            case 5: ConfigureRestock(); break;
            case 6: ImportExtensions(); break;
            case 7:
                foreach (var browser in browsers) browser.CoreWebView2?.Reload();
                break;
            case 8:
                FormBorderStyle = FormBorderStyle == FormBorderStyle.None
                    ? FormBorderStyle.Sizable : FormBorderStyle.None;
                WindowState = FormWindowState.Maximized;
                break;
            case 9: OpenSite("https://multitwitch.tv/", "MultiTwitch"); break;
            case 10: OpenSite("https://pokeidle-ferramentas.pages.dev/#hunt", "Onde caçar"); break;
            case 11: _ = AutoUpdater.CheckAsync(this, manual: true); break;
        }
        UpdateClassicToolbar();
    }

    private void UpdateClassicToolbar()
    {
        if (classicToolbar.CoreWebView2 == null) return;
        var state = JsonSerializer.Serialize(new { type = "state", focused, visible, zoom = zoom[0] });
        classicToolbar.CoreWebView2.PostWebMessageAsJson(state);
    }

    private readonly Dictionary<string, Button> buttons = new();

    private static Button NightButton(string label, int height = 27)
    {
        var b = new Button
        {
            Text = label,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            MinimumSize = new Size(27, height),
            Height = height,
            FlatStyle = FlatStyle.Flat,
            ForeColor = Color.FromArgb(248, 250, 252),
            BackColor = Color.FromArgb(30, 41, 59),
            Font = new Font("Segoe UI", 8.5f, FontStyle.Regular),
            Padding = new Padding(5, 0, 5, 0),
            Margin = new Padding(3, 2, 3, 2),
            Cursor = Cursors.Hand,
            UseVisualStyleBackColor = false
        };
        b.FlatAppearance.BorderColor = Color.FromArgb(51, 65, 85);
        b.FlatAppearance.BorderSize = 1;
        b.FlatAppearance.MouseOverBackColor = Color.FromArgb(51, 65, 85);
        b.FlatAppearance.MouseDownBackColor = Color.FromArgb(91, 33, 182);
        return b;
    }

    private void AddButton(string label, Action action, string? key = null)
    {
        var b = NightButton(label, 30);
        b.Click += (_, _) => action();
        toolbar.Controls.Add(b);
        if (key != null) buttons[key] = b;
    }

    private Button PaneButton(string label, Action action, string tooltip)
    {
        var b = NightButton(label, 23);
        b.Font = new Font("Segoe UI Symbol", 9f);
        b.Padding = new Padding(3, 0, 3, 0);
        b.Margin = new Padding(2, 2, 2, 2);
        b.Click += (_, _) => action();
        new ToolTip().SetToolTip(b, tooltip);
        return b;
    }

    private void CreatePane(int i)
    {
        var panel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(23, 32, 51),
            Margin = new Padding(3),
            Padding = new Padding(1)
        };
        var bar = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 31,
            WrapContents = false,
            AutoScroll = true,
            BackColor = Color.FromArgb(17, 24, 39),
            Padding = new Padding(4, 2, 4, 2)
        };
        var status = new Label
        {
            Text = "●",
            AutoSize = true,
            ForeColor = Color.FromArgb(34, 197, 94),
            Font = new Font("Segoe UI", 10f),
            Padding = new Padding(0, 3, 0, 0)
        };
        bar.Controls.Add(status);
        bar.Controls.Add(new Label
        {
            Text = $"Conta {i + 1}",
            AutoSize = true,
            ForeColor = Color.FromArgb(248, 250, 252),
            Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
            Padding = new Padding(2, 5, 7, 0)
        });
        var zoomText = new Label
        {
            Text = $"{zoom[i]}%",
            AutoSize = true,
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 8f),
            Padding = new Padding(1, 6, 1, 0)
        };
        bar.Controls.Add(PaneButton("−", () => { ChangeZoom(i, -10); zoomText.Text = $"{zoom[i]}%"; }, "Diminuir zoom"));
        bar.Controls.Add(zoomText);
        bar.Controls.Add(PaneButton("+", () => { ChangeZoom(i, 10); zoomText.Text = $"{zoom[i]}%"; }, "Aumentar zoom"));
        bar.Controls.Add(PaneButton("🛒", ConfigureRestock, "Configurar Restock"));
        bar.Controls.Add(PaneButton("⟳", () => browsers[i].CoreWebView2?.Reload(), "Recarregar conta"));
        bar.Controls.Add(PaneButton("⛶", () => { focused = focused == i ? null : i; Rebuild(); }, "Expandir ou restaurar conta"));
        bar.Controls.Add(PaneButton("◌", () => { visible[i] = false; focused = null; Rebuild(); SaveUiSettings(); }, "Ocultar conta"));
        var browser = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(15, 15, 22) };
        panel.Controls.Add(browser);
        panel.Controls.Add(bar);
        panes[i] = panel;
        browsers[i] = browser;
    }

    private const string EchoCapture = """
    (() => {
      if (window.__pokeEchoInstalled) return;
      window.__pokeEchoInstalled = true;
      document.addEventListener('click', e => {
        if (!e.isTrusted || !window.chrome?.webview) return;
        const t = e.target;
        if (!(t instanceof Element)) return;
        const r = t.getBoundingClientRect();
        chrome.webview.postMessage({ kind:'echo', x:e.clientX, y:e.clientY,
          rx:r.width ? (e.clientX-r.left)/r.width : .5,
          ry:r.height ? (e.clientY-r.top)/r.height : .5,
          selector: t.id ? '#'+CSS.escape(t.id) : null });
      }, true);
    })();
    """;

    private async Task InitializeBrowsers()
    {
        for (int i = 0; i < 4; i++)
        {
            int account = i;
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(dataPath, $"account-{i + 1}"));
                await browsers[i].EnsureCoreWebView2Async(env);
                var core = browsers[i].CoreWebView2;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDevToolsEnabled = true;
                await core.AddScriptToExecuteOnDocumentCreatedAsync(EchoCapture);
                // Injeta antes dos scripts do jogo para capturar o WebSocket do Restock.
                await core.AddScriptToExecuteOnDocumentCreatedAsync(restockScript);
                core.WebMessageReceived += (_, args) => HandleEcho(account, args.WebMessageAsJson);
                core.NavigationCompleted += async (_, _) => await ApplyRestock(account);
                browsers[i].ZoomFactor = zoom[i] / 100.0;
                core.Navigate("https://pokeidle.io/");
            }
            catch (Exception ex) { MessageBox.Show($"Conta {i + 1}: {ex.Message}", "Erro WebView2"); }
        }
    }

    private async void HandleEcho(int source, string message)
    {
        if (!echoEnabled || !echoSources[source]) return;
        try
        {
            using var json = JsonDocument.Parse(message);
            var obj = json.RootElement;
            if (obj.GetProperty("kind").GetString() != "echo") return;
            double x = obj.GetProperty("x").GetDouble(), y = obj.GetProperty("y").GetDouble();
            double rx = obj.GetProperty("rx").GetDouble(), ry = obj.GetProperty("ry").GetDouble();
            string selector = obj.GetProperty("selector").ValueKind == JsonValueKind.String ? obj.GetProperty("selector").GetString() ?? "" : "";
            for (int i = 0; i < 4; i++)
            {
                if (i == source || !echoTargets[i] || browsers[i].CoreWebView2 == null) continue;
                string js = $"(() => {{ let el = {JsonSerializer.Serialize(selector)} ? document.querySelector({JsonSerializer.Serialize(selector)}) : null; let x={x.ToString(System.Globalization.CultureInfo.InvariantCulture)},y={y.ToString(System.Globalization.CultureInfo.InvariantCulture)}; if(el){{const r=el.getBoundingClientRect();x=r.left+r.width*{rx.ToString(System.Globalization.CultureInfo.InvariantCulture)};y=r.top+r.height*{ry.ToString(System.Globalization.CultureInfo.InvariantCulture)};}} el=document.elementFromPoint(x,y); if(el) el.click(); }})()";
                _ = browsers[i].CoreWebView2.ExecuteScriptAsync(js);
            }
        }
        catch { /* Eventos malformados não interrompem o jogo. */ }
    }

    private void ToggleEcho()
    {
        echoEnabled = !echoEnabled;
        buttons["echoButton"].Text = echoEnabled ? "⇄  Echo: ON" : "⇄  Echo: OFF";
    }
    private void ConfigureEcho()
    {
        using var form = new Form { Text = "Echo — origem e destinos", Width = 340, Height = 330, StartPosition = FormStartPosition.CenterParent };
        var root = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true };
        form.Controls.Add(root);
        root.Controls.Add(new Label { Text = "Selecione origens e destinos dos cliques:", AutoSize = true });
        for (int i = 0; i < 4; i++)
        {
            int index = i;
            var line = new FlowLayoutPanel { Width = 290, Height = 36 };
            line.Controls.Add(new Label { Text = $"Conta {i + 1}", Width = 75, TextAlign = ContentAlignment.MiddleLeft });
            var src = new CheckBox { Text = "Origem", Checked = echoSources[i], AutoSize = true };
            var dst = new CheckBox { Text = "Destino", Checked = echoTargets[i], AutoSize = true };
            src.CheckedChanged += (_, _) => echoSources[index] = src.Checked;
            dst.CheckedChanged += (_, _) => echoTargets[index] = dst.Checked;
            line.Controls.Add(src); line.Controls.Add(dst); root.Controls.Add(line);
        }
        root.Controls.Add(new Label { Text = "Echo replica cliques DOM. Ações em canvas podem não funcionar.", AutoSize = true, MaximumSize = new Size(290, 0) });
        form.ShowDialog(this);
    }

    private JsonObject DefaultRestock() => JsonNode.Parse("""{"on":false,"balls":{"on":false,"id":1,"keep":0,"below":0},"revives":{"on":false,"id":0,"keep":0,"below":0},"potions":{"on":false,"id":0,"keep":0,"below":0},"potionFirst":false,"goldFloor":0}""")!.AsObject();
    private JsonObject LoadRestock(int i)
    {
        try { return JsonNode.Parse(File.ReadAllText(Path.Combine(dataPath, $"restock-{i + 1}.json")))!.AsObject(); }
        catch { return DefaultRestock(); }
    }
    private async Task ApplyRestock(int i)
    {
        if (browsers[i].CoreWebView2 == null) return;
        try { await browsers[i].CoreWebView2.ExecuteScriptAsync($"window.__deckRecompra?.configure({restock[i].ToJsonString()});"); }
        catch { }
    }
    private void ConfigureRestock()
    {
        using var f = new Form { Text = "Restock — configuração por conta", Width = 480, Height = 570, StartPosition = FormStartPosition.CenterParent };
        var p = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoScroll = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(12) };
        f.Controls.Add(p);
        var account = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 200 };
        account.Items.AddRange(new object[] { "Conta 1", "Conta 2", "Conta 3", "Conta 4" }); account.SelectedIndex = 0;
        p.Controls.Add(account);
        var on = new CheckBox { Text = "Ativar recompra (desligada por padrão)", AutoSize = true };
        p.Controls.Add(on);
        var fields = new Dictionary<string, (CheckBox enabled, NumericUpDown id, NumericUpDown keep, NumericUpDown below)>();
        foreach (string kind in new[] { "balls", "revives", "potions" })
        {
            var label = new Label { Text = kind == "balls" ? "Pokébolas" : kind == "revives" ? "Revives" : "Poções", AutoSize = true, Font = new Font(Font, FontStyle.Bold) };
            p.Controls.Add(label);
            var enabled = new CheckBox { Text = "Recomprar", AutoSize = true }; p.Controls.Add(enabled);
            NumericUpDown Field(string title, decimal max)
            {
                var line = new FlowLayoutPanel { Width = 410, Height = 30 };
                line.Controls.Add(new Label { Text = title, Width = 180, TextAlign = ContentAlignment.MiddleLeft });
                var num = new NumericUpDown { Width = 150, Maximum = max };
                line.Controls.Add(num); p.Controls.Add(line); return num;
            }
            var id = Field("ID do item (0 = automático)", 1000000);
            var keep = Field("Manter quantidade", 10000000);
            var below = Field("Comprar abaixo de", 10000000);
            fields[kind] = (enabled, id, keep, below);
        }
        var gold = new NumericUpDown { Maximum = 1000000000, Width = 150 };
        p.Controls.Add(new Label { Text = "Reserva mínima de ouro", AutoSize = true }); p.Controls.Add(gold);
        var potionFirst = new CheckBox { Text = "Priorizar poção escolhida", AutoSize = true }; p.Controls.Add(potionFirst);
        void Read()
        {
            var c = restock[account.SelectedIndex]; on.Checked = c["on"]?.GetValue<bool>() ?? false;
            foreach (var (kind, ctrls) in fields)
            {
                var r = c[kind];
                ctrls.enabled.Checked = r?["on"]?.GetValue<bool>() ?? false;
                ctrls.id.Value = Math.Clamp(r?["id"]?.GetValue<int>() ?? 0, 0, ctrls.id.Maximum);
                ctrls.keep.Value = Math.Clamp(r?["keep"]?.GetValue<int>() ?? 0, 0, ctrls.keep.Maximum);
                ctrls.below.Value = Math.Clamp(r?["below"]?.GetValue<int>() ?? 0, 0, ctrls.below.Maximum);
            }
            gold.Value = Math.Clamp(c["goldFloor"]?.GetValue<long>() ?? 0, 0, gold.Maximum);
            potionFirst.Checked = c["potionFirst"]?.GetValue<bool>() ?? false;
        }
        account.SelectedIndexChanged += (_, _) => Read(); Read();
        var save = new Button { Text = "Salvar nesta conta", AutoSize = true, Height = 32 };
        save.Click += async (_, _) =>
        {
            int i = account.SelectedIndex;
            var c = new JsonObject { ["on"] = on.Checked, ["goldFloor"] = (long)gold.Value, ["potionFirst"] = potionFirst.Checked };
            foreach (var (kind, ctrls) in fields)
                c[kind] = new JsonObject { ["on"] = ctrls.enabled.Checked, ["id"] = (int)ctrls.id.Value, ["keep"] = (int)ctrls.keep.Value, ["below"] = (int)ctrls.below.Value };
            restock[i] = c;
            File.WriteAllText(Path.Combine(dataPath, $"restock-{i + 1}.json"), c.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            await ApplyRestock(i);
            MessageBox.Show($"Configuração salva na conta {i + 1}.", "Restock");
        };
        p.Controls.Add(save);
        f.ShowDialog(this);
    }

    private async void ImportExtensions()
    {
        // Extensões Chrome/Edge já instaladas normalmente ficam em pastas ID/versão.
        string chrome = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "User Data", "Default", "Extensions");
        string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "User Data", "Default", "Extensions");
        using var f = new Form { Text = "Selecionar extensões para importar", Width = 650, Height = 550, StartPosition = FormStartPosition.CenterParent };
        var root = new Panel { Dock = DockStyle.Fill }; f.Controls.Add(root);
        var list = new CheckedListBox { Dock = DockStyle.Fill, CheckOnClick = true };
        var options = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 38 };
        var account = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 120 };
        account.Items.AddRange(new object[] { "Conta 1", "Conta 2", "Conta 3", "Conta 4" }); account.SelectedIndex = 0;
        options.Controls.Add(new Label { Text = "Importar para:", AutoSize = true, Padding = new Padding(0, 8, 0, 0) }); options.Controls.Add(account);
        var scan = new Button { Text = "Buscar Chrome / Edge", AutoSize = true };
        options.Controls.Add(scan);
        var addFolder = new Button { Text = "Escolher pasta", AutoSize = true }; options.Controls.Add(addFolder);
        var bottom = new Button { Text = "Importar selecionadas", Dock = DockStyle.Bottom, Height = 38 };
        root.Controls.Add(list); root.Controls.Add(bottom); root.Controls.Add(options);
        var found = new List<(string name, string path)>();
        void Add(string path)
        {
            try
            {
                var manifest = Path.Combine(path, "manifest.json");
                if (!File.Exists(manifest) || found.Any(e => e.path.Equals(path, StringComparison.OrdinalIgnoreCase))) return;
                using var doc = JsonDocument.Parse(File.ReadAllText(manifest));
                string name = doc.RootElement.TryGetProperty("name", out var n) ? n.GetString() ?? Path.GetFileName(path) : Path.GetFileName(path);
                found.Add((name, path)); list.Items.Add($"{name} — {path}");
            }
            catch { }
        }
        void Scan()
        {
            foreach (var baseDir in new[] { chrome, edge })
            {
                if (!Directory.Exists(baseDir)) continue;
                foreach (var id in Directory.EnumerateDirectories(baseDir))
                    foreach (var version in Directory.EnumerateDirectories(id)) Add(version);
            }
        }
        scan.Click += (_, _) => Scan();
        addFolder.Click += (_, _) => { using var folder = new FolderBrowserDialog { Description = "Selecione a pasta descompactada da extensão (com manifest.json)" }; if (folder.ShowDialog(f) == DialogResult.OK) Add(folder.SelectedPath); };
        bottom.Click += async (_, _) =>
        {
            if (list.CheckedIndices.Count == 0) { MessageBox.Show("Marque as extensões que deseja importar."); return; }
            int i = account.SelectedIndex;
            if (browsers[i].CoreWebView2 == null) { MessageBox.Show("Aguarde o carregamento da conta."); return; }
            int ok = 0; var errors = new List<string>();
            foreach (int index in list.CheckedIndices)
            {
                var ext = found[index];
                try
                {
                    // WebView2 requer extensão descompactada. Copiamos para pasta persistente.
                    string dest = Path.Combine(dataPath, "imported-extensions", $"account-{i + 1}", Path.GetFileName(Path.GetDirectoryName(ext.path) ?? ext.path) + "_" + Path.GetFileName(ext.path));
                    CopyDirectory(ext.path, dest);
                    await browsers[i].CoreWebView2.Profile.AddBrowserExtensionAsync(dest);
                    ok++;
                }
                catch (Exception ex) { errors.Add($"{ext.name}: {ex.Message}"); }
            }
            MessageBox.Show($"Importadas: {ok}.\n" + string.Join("\n", errors), "Resultado da importação");
        };
        Scan(); f.ShowDialog(this);
    }
    private static void CopyDirectory(string source, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (string file in Directory.EnumerateFiles(source)) File.Copy(file, Path.Combine(dest, Path.GetFileName(file)), true);
        foreach (string dir in Directory.EnumerateDirectories(source)) CopyDirectory(dir, Path.Combine(dest, Path.GetFileName(dir)));
    }

    private void LoadUiSettings()
    {
        try
        {
            if (!File.Exists(UiSettingsPath)) return;
            using var document = JsonDocument.Parse(File.ReadAllText(UiSettingsPath));
            var root = document.RootElement;
            if (root.TryGetProperty("layout", out var savedLayout))
            {
                var value = savedLayout.GetString();
                if (value is "2x2" or "1x4") layout = value;
            }
            if (root.TryGetProperty("zoom", out var savedZoom) && savedZoom.ValueKind == JsonValueKind.Array)
            {
                for (int i = 0; i < Math.Min(4, savedZoom.GetArrayLength()); i++)
                    if (savedZoom[i].TryGetInt32(out var value)) zoom[i] = Math.Clamp(value, 40, 150);
            }
            if (root.TryGetProperty("visible", out var savedVisible) && savedVisible.ValueKind == JsonValueKind.Array)
            {
                for (int i = 0; i < Math.Min(4, savedVisible.GetArrayLength()); i++)
                    if (savedVisible[i].ValueKind is JsonValueKind.True or JsonValueKind.False)
                        visible[i] = savedVisible[i].GetBoolean();
                if (!visible.Any(v => v)) visible[0] = true;
            }
        }
        catch { /* Configuracao ausente ou corrompida: usar padroes. */ }
    }

    private void SaveUiSettings()
    {
        try
        {
            var settings = new { layout, zoom, visible };
            File.WriteAllText(UiSettingsPath, JsonSerializer.Serialize(settings));
        }
        catch { /* Falha de escrita nao deve interromper o jogo. */ }
    }

    private void ChangeZoom(int i, int delta)
    {
        zoom[i] = Math.Clamp(zoom[i] + delta, 40, 150);
        if (browsers[i].CoreWebView2 != null) browsers[i].ZoomFactor = zoom[i] / 100.0;
        SaveUiSettings();
        UpdateClassicToolbar();
    }
    private void Rebuild()
    {
        grid.SuspendLayout();
        // Remover controles sem descartá-los: mantém sessões WebView2 vivas.
        grid.Controls.Clear(); grid.ColumnStyles.Clear(); grid.RowStyles.Clear();
        var indices = Enumerable.Range(0, 4).Where(i => visible[i] && (focused == null || focused == i)).ToArray();
        if (indices.Length == 0) { visible[0] = true; indices = new[] { 0 }; }
        // Vertical 1x4: quatro janelas estreitas em formato retrato, lado a lado.
        int columns = focused != null ? 1 : layout == "1x4" ? indices.Length : Math.Min(2, indices.Length);
        int rows = (int)Math.Ceiling(indices.Length / (double)columns);
        grid.ColumnCount = columns; grid.RowCount = rows;
        for (int c = 0; c < columns; c++) grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f / columns));
        for (int r = 0; r < rows; r++) grid.RowStyles.Add(new RowStyle(SizeType.Percent, 100f / rows));
        for (int n = 0; n < indices.Length; n++) grid.Controls.Add(panes[indices[n]], n % columns, n / columns);
        grid.ResumeLayout(true);
        UpdateClassicToolbar();
    }
    private void OpenSite(string url, string title)
    {
        var window = new Form { Text = title, Width = 1100, Height = 780, StartPosition = FormStartPosition.CenterScreen };
        var browser = new WebView2 { Dock = DockStyle.Fill }; window.Controls.Add(browser);
        window.Shown += async (_, _) =>
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(dataPath, "tools"));
                await browser.EnsureCoreWebView2Async(env); browser.CoreWebView2.Navigate(url);
            }
            catch (Exception ex) { MessageBox.Show(ex.Message, "Erro ao abrir página"); }
        };
        window.Show(this);
    }
}
