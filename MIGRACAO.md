# Night Deck Electron 1.45.2

Restaurado a partir do projeto original PokeIdle Multiscreen v1.45.1 fornecido pelo usuario.

## Como publicar no GitHub

A branch `backup-csharp` preserva o codigo C# antigo. Substitua o conteudo da branch `main` pelos arquivos desta pasta, incluindo `.github/workflows/build.yml` (nao envie `node_modules` nem `dist`). Um push em main aciona o GitHub Actions e gera instalador `.exe` em Releases.

## Compilacao local

Node.js 22, `npm ci`, `npm run build`.

## Sessoes

A pasta de dados `PokeIdle Multiscreen` e preservada para manter sessoes existentes, mas sempre faca backup antes de substituir o aplicativo.

## Observacoes

A compilacao Windows ainda precisa ser executada no GitHub Actions. A atualizacao automatica dentro do aplicativo e o icone personalizado ainda precisam ser integrados e testados. A release publica um instalador, nao uma atualizacao silenciosa.
