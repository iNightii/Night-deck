# Night Deck: GitHub Actions

1. Crie um repositório **privado** chamado Night-Deck no GitHub.
2. Envie o conteúdo deste ZIP para a raiz do repositório, mantendo `.github/workflows/build-windows.yml`.
3. Abra Actions > Build Night Deck (Windows) > Run workflow.
4. Quando a execução terminar, baixe o artifact `Night-Deck-Windows-x64` e extraia o ZIP.
5. Execute `NightDeck.exe` no Windows. O WebView2 Runtime pode ser necessário.

O build é experimental e pode falhar por problemas de compilação do código C# ainda não testado.
