# PokeIdle Multiscreen v1.41.0

Aplicativo Electron com até quatro sessões independentes do PokeIdle.

## Novidades da v1.37.0
- **Twitch com vídeo por conta:** em cada conta da janela Twitch há o botão **Abrir vídeo**. Ele abre uma sessão de navegador persistente e isolada; entre na Twitch com a conta correspondente e inicie uma transmissão. Para presença de visualização, o vídeo precisa estar realmente reproduzindo. A sessão de vídeo é separada do login OAuth usado para IRC.
- **Importação do Chrome:** no menu **Extensões**, use **Importar extensões instaladas no Chrome** para copiar extensões dos perfis Chrome Default/Profile para o app. Também há atalho para abrir a Chrome Web Store; instale a extensão no Chrome e depois importe. O app copia os arquivos e carrega a extensão no Electron. Nem todas as APIs do Chrome, especialmente algumas extensões Manifest V3, são suportadas pelo Electron.
- As extensões importadas são copiadas para a pasta de dados do app, então não dependem da pasta original do Chrome.

## Novidades da v1.36.0
- **Login da Twitch pelo navegador:** em **Twitch > Conectar** o app abre a página da Twitch no seu navegador padrão, já com o código preenchido; é só autorizar. Nenhuma senha passa pelo app. O acesso é renovado sozinho (não precisa logar de novo). Para outra conta Twitch, use **Copiar link** e abra numa janela anônima.
- **HUD novo na barra de cima:** menu **Extensões**, seletor de desempenho (**Normal / Economia / Ultra**), **zoom global** (− 100% +, clique no número para voltar a 100%) e **Tela cheia** (F11).
- **Modo Ultra:** além da economia, remove animações, sombras e filtros das páginas e limita a animação a poucos quadros por segundo. Contadores e temporizadores do jogo continuam normais.
- **Barra de cada conta:** bolinha de status, "rodando há X min", botão de **silenciar**, **recarregar**, **expandir**, **esconder** (continua rodando) e **desligar** (descarrega o jogo e libera CPU e memória; para ligar, clique no botão da conta na barra de cima).
- **Extensões:** adicione extensões do Chrome (pasta descompactada com `manifest.json`); elas são carregadas nas 4 contas. Obs.: o Electron suporta só parte dos recursos de extensões do Chrome.
- O antigo botão **Economia** virou uma opção do seletor de desempenho.

## Histórico
### v1.35.0
- **Repositor removido** (botão, janela e código).
- Um único botão **Twitch** (ícone da Twitch) abre a janela de presença no chat. Dentro dela há o botão **Abrir lives**, que abre no navegador as lives oficiais no ar (o antigo botão Lives).

### v1.34.0
- Novo botão **Chat**: mantém até 4 contas Twitch presentes no chat dos canais oficiais, como o Chatterino (sem baixar vídeo, quase sem memória). Cada conta Twitch deve ser a mesma vinculada na conta correspondente do PokeIdle.
  - Configuração única: crie um aplicativo em https://dev.twitch.tv/console/apps (URL de redirecionamento `http://localhost`, tipo de cliente **Público**) e cole o Client ID na janela. Depois, clique em **Conectar** em cada conta e faça login na Twitch.
  - O acesso de cada conta fica criptografado no computador (Windows DPAPI). A lista de canais é editável.
  - Reconecta sozinho se a conexão cair.

### v1.33.0
- Contas escondidas não aparecem mais como etiquetas separadas na barra de cima. Cada conta tem um botão só: clique = tela principal; conta escondida fica apagada, com o ícone de olho cortado, e um clique traz de volta. Clique direito no botão esconde/mostra a conta.

### v1.32.0
- **Sistema de janelas refeito:** a janela transparente que ficava por cima dos jogos foi removida. A barra superior e as barras de cada conta agora são telas nativas dentro da própria janela e são posicionadas junto com os jogos, no mesmo passo. Resultado: sem atraso ao mover/redimensionar, cliques diretos nos jogos e menos trabalho para a placa de vídeo.
- Redimensionar a janela responde na hora e agrupa as atualizações seguintes (~40 por segundo).
- Trocar o layout sempre sai do modo "tela principal" (pelo menu também).
- As contas carregam escalonadas na abertura (menos pico de CPU).
- **Onde caçar** agora abre https://pokeidle-gg.pages.dev/#hunt.

### v1.31.0
- Repositor: **Detectar ouro** no lugar de digitar o valor exato. O app lista os números da tela (o mais provável primeiro) e você escolhe o seu ouro; também aceita um valor aproximado (margem de 3%), já que o ouro muda enquanto você caça.
- Se o app deixar de conseguir ler o ouro, o Repositor avisa no painel e não compra até você detectar de novo.

### v1.30.0
- Novo botão **Repositor**: janela que monitora e recompra Pokébolas e Poções no Market quando o estoque fica abaixo do limite.
  - Começa em **modo teste** (só mostra o que compraria). Desligue o modo teste para comprar de verdade.
  - Escolha as contas (1 a 4), quanto manter, abaixo de quanto recomprar e o ouro mínimo a preservar.
  - Segurança: não compra sem o ouro calibrado, nunca passa do ouro mínimo, uma compra por vez (até 9.999), e pausa a conta se 3 compras seguidas não aumentarem o estoque.
  - Exige o Market aberto na conta. Use **Calibrar ouro** uma vez e **Copiar diagnóstico** se algo não for reconhecido.
- O antigo código de auto-compra foi removido (substituído pelo Repositor).

### v1.29.0
- Menu **Ajuda**: *Modo compatibilidade (sem aceleração de GPU)*, *Diagnóstico de GPU* e *Abrir pasta de logs*.
- O app agora registra em `crash-log.txt` quando algum processo (inclusive o de GPU) cai, com o motivo.

### v1.28.0
- Interface renovada: ícones, alternador de layout animado, barras de conta reorganizadas e transições suaves.
- Mais leve: redimensionar a janela e trocar de conta ficaram mais rápidos; a taxa de quadros se ajusta ao layout.
- Botão **Economia**: contas fora de vista param de ser desenhadas (desligado por padrão).
- Botão **Lives**: abre no navegador todas as lives oficiais no ar (bônus Twitch) em uma única aba (multitwitch.tv). Exige o painel "Bônus Twitch" aberto na Conta 1. Em `main.js`, `TWITCH_OPEN_MODE` troca entre `'multi'` (uma aba) e `'tabs'` (uma aba por canal).
- Correções: contas escondidas não voltam mais a ocupar espaço ao reabrir o app; botão de tela principal não fica mais marcado depois de trocar o layout.
- A versão agora aparece no título da janela.

### v1.27.0
- Removida a extensão local Hunt for PokeIdle e o recurso `/hunt`, que deixou de funcionar.
- Adicionado o botão **Onde caçar**, abrindo https://pokeidle-ferramentas.pages.dev/#hunt no navegador padrão.
- Painel Auto-compra permanece removido.

## Executar e compilar
1. Instale Node.js LTS.
2. Abra o terminal nesta pasta e execute `npm install`.
3. Para executar: `npm start`.
4. Para criar o instalador Windows x64: `npm run build` (gera `dist/PokeIdle-Multiscreen-v1.37.0.exe`).


## v1.38.0 — Echo entre contas

- Adiciona o recurso Echo: quando ativado no botão **Echo**, um clique real em um botão/controle de uma conta é replicado nas demais contas visíveis.
- Não replica digitação, seleção de texto ou alterações de campos de entrada. A conta de origem não recebe o próprio clique novamente.
- O recurso fica desligado por padrão e a preferência é salva em `config.json`.
- A reprodução exige que o controle correspondente exista e tenha o mesmo texto acessível; se não houver correspondência segura, o clique é ignorado.

- Nas janelas de vídeo da Twitch, adiciona bloqueio de domínios conhecidos de anúncios/rastreadores e tenta selecionar a menor qualidade de vídeo disponível, reduzindo consumo de rede e RAM.
- Adiciona leitura agregada de RAM do aplicativo na barra superior (atualizada a cada 5 segundos).

A integração das funções da referência é gradual; consulte a seção de versão atual para ver o que foi migrado e o que ainda está pendente.


## v1.40.0 — TopIdle, Kick e Rotom Sniper por conta

- Cada barra de conta agora tem **🛒 Recompra**: configura pokébolas, revives, poções, estoque-alvo, limite de compra e ouro mínimo por conta. O script roda como extensão local em `document_start`, observa o WebSocket do jogo e só faz compras quando a opção principal está marcada. A recompra fica desligada por padrão em todas as contas. O resgate Kick também fica desativado por padrão e só é executado após escolher um bônus na configuração da conta; se os pontos voltarem após um resgate, ele pausa automaticamente.
- Cada barra de conta agora tem **TopIdle**: consulta a sessão dessa conta, mostra se o voto está liberado, abre a página oficial de voto com o nick do jogo quando disponível e avisa quando o POST de voto é confirmado. O login do TopIdle fica separado por conta, na mesma sessão persistente.
- Cada barra também tem **K**: consulta a lista configurada de canais Kick e abre até `kickSlots` lives ao vivo em janelas próprias, usando a sessão persistente da conta. A lista é reavaliada a cada 30 segundos e as janelas são ajustadas conforme as lives ficam online/offline. O painel de recompra também permite configurar o resgate automático de XP, Captura ou Shiny; ele fica desligado por padrão e só atua com live aberta e login da Kick na conta. As janelas usam o player `player.kick.com` e bloqueiam domínios conhecidos de anúncios/rastreadores.
- Cada barra tem **🎯** para ligar/desligar o Rotom Sniper da extensão na conta correspondente, usando o armazenamento local da extensão. Também existe opção para alternar em todas as contas no menu Recursos.
- Canais configuráveis em `config.json` (`kickChannels`) e limite (`kickSlots`, padrão 2). O menu **Recursos** explica onde editar.

**Ainda não migrada nesta versão:** importação do armazenamento/configurações de extensões. Esses itens ficam explicitamente desativados; não foram simulados nem ligados por padrão.

A consulta TopIdle e a abertura Kick precisam ser testadas com as contas reais e com as APIs atuais dos serviços.

### Importar configurações internas de extensões

No menu **Extensões**, abra o submenu da extensão desejada e escolha **Importar configurações (Chrome / IdleDeck / outra conta)**. Selecione a origem e a conta de destino. O recurso localiza dados `chrome.storage.local` no Chrome/Chromium, IdleDeck e nas quatro contas do Multiscreen.

A importação é agendada para a próxima abertura do aplicativo, porque o Chromium mantém o banco LevelDB aberto enquanto a conta está em execução. Feche o Multiscreen completamente e abra novamente. Antes de substituir os dados do destino, o app cria uma cópia de segurança em `extension-storage-backups`, dentro da pasta de dados do aplicativo. A origem não é alterada.

A importação depende de a extensão usar o mesmo ID no navegador de origem e no Multiscreen. Extensões que não persistem dados em `chrome.storage.local` ou que usam outro mecanismo de armazenamento não terão dados para importar.


## v1.41.0 — Correção do Echo
- Corrigido o transporte dos cliques do preload para o processo principal: agora usa `ipcRenderer.send`/`ipcMain` compatível com `WebContentsView`, em vez de `sendToHost` (destinado a `<webview>`).
- O processo principal identifica a conta de origem pelo `WebContents` e replica o clique nas demais contas visíveis e ativas.
- Campos de texto, caixas de seleção e áreas editáveis continuam excluídos.

## v1.42 — limpeza periódica de memória
- Solicita coleta de lixo do V8 no processo principal e nos renderizadores a cada 10 minutos, sem recarregar o PokeIdle nem apagar cookies/cache.
- Recupera objetos JavaScript sem referências. Windows/Chromium podem manter RAM reservada para reutilização; portanto, a leitura não necessariamente cai imediatamente ou até um valor fixo.


## v1.43.0 — Kick com player, chat e login

- As janelas das lives Kick agora abrem a página completa do canal (`kick.com/canal`) em vez do player isolado. Assim, a janela mostra o player e o chat e permite entrar na conta da Kick usando a sessão persistente da conta selecionada no Multiscreen.
- As janelas abrem maiores e continuam separadas por conta. O login fica salvo na sessão correspondente.
- Acompanhar lives e abrir a página completa não garante que a Kick mantenha o login se a própria plataforma exigir nova autenticação.


## v1.44.0 — Barras organizadas
Os controles da conta foram agrupados em menus nativos Kick, Ferramentas e Conta; os links e ações gerais também foram agrupados na barra superior. As ações originais permanecem disponíveis nos menus.
