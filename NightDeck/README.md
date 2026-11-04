# Night Deck C# 0.2 — experimental

## Incluído
- Quatro contas WebView2 com perfis independentes, grade 2x2, vertical, foco, zoom, recarga e ocultação.
- Echo opt-in com origem/destino configuráveis. Replica cliques em elementos HTML; cliques em canvas, atalhos de teclado e eventos sintéticos não estão garantidos.
- Restock opt-in por conta, com configurações de pokébolas, revives, poções e reserva de ouro. Reutiliza o script `recompra.js` do projeto Electron v1.45.1. **Pode efetuar compras reais no jogo quando ativado.**
- Importação seletiva de extensões instaladas no perfil **Default** do Chrome/Edge ou de uma pasta descompactada, usando `CoreWebView2Profile.AddBrowserExtensionAsync`. As extensões são copiadas para armazenamento persistente por conta. Algumas extensões não são compatíveis com WebView2; configurações internas não são migradas.
- MultiTwitch e Onde caçar.

## Executar
Instale .NET 8 SDK e Microsoft Edge WebView2 Runtime. No terminal Windows na pasta do projeto:

```
dotnet restore
dotnet run
```

Para publicar:

```
dotnet publish -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true
```

## Limitações importantes
- Não foi compilado nem testado em Windows neste ambiente (SDK .NET indisponível). Esta é uma versão **experimental**, não a conversão completa.
- O Echo é um primeiro mecanismo baseado em cliques DOM, não uma cópia exata do Echo do Electron.
- O Restock depende do funcionamento do script original e da compatibilidade atual do jogo. Deve ser testado com a recompra desligada inicialmente.
- A importação de extensões pode falhar por incompatibilidade do manifesto, APIs não suportadas, políticas do navegador ou dependências; não copia cookies, senhas nem configurações das extensões.
- Não há instalador EXE pronto; o projeto inclui fonte para compilar no Windows.
- Kick e Rotom Sniper/TopIdle ficam fora desta etapa conforme solicitado.

> Os dados existentes continuam em `PokeIdleMultiscreenCS` para preservar logins e configurações anteriores.
