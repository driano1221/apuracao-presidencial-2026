PAINEL PRESIDENCIAL 2026 — PUBLICAÇÃO GRATUITA

Endereço público:
https://driano1221.github.io/apuracao-presidencial-2026/

Painel independente, sem vínculo institucional com o TSE.
Acesso público, sem conta do ChatGPT e sem login do visitante.
Código e dados públicos: https://github.com/driano1221/apuracao-presidencial-2026

COMO FUNCIONA
O GitHub Pages serve a interface estática, incluindo fontes locais e o botão
TESTE. A rotina de publicação do conjunto de dados roda no GitHub Actions,
consulta o JSON nacional do TSE a cada aproximadamente 2 segundos e arquiva
somente novas gerações. O contexto da eleição é identificado no EA11; os
votos vêm do EA20. Nenhuma candidatura fictícia entra nos arquivos oficiais.

Novas gerações são publicadas assim que observadas, com intervalo mínimo de
10 segundos entre publicações. Sem mudanças, o registro de última consulta
é publicado uma vez por minuto. O navegador consulta a versão publicada a
cada 65 segundos e baixa o histórico apenas quando há nova geração.
O endereço do commit evita o cache atrasado da branch: a API anônima do
GitHub limita consultas a 60 por hora/IP, portanto não é adequado consultá-la
a cada 2 segundos. Se a API falhar ou limitar acesso, a branch pública é
usada como alternativa, com possível atraso de cache. A interface preserva
o último resultado e informa quando o arquivo está atrasado.
A coleta central continua a cada aproximadamente 2 segundos, mas a
atualização visível desta versão gratuita ocorre em torno de um minuto,
somado à publicação e ao cache do próprio TSE. Nenhum serviço usa os runners
como servidor HTTP. O modo TESTE atualiza a cada 0,5 segundo.

A coleta independe do computador e de páginas abertas. Usa quatro etapas
de até 5 horas, sequenciais, recuperando os registros da branch dados em cada
reinício. Para quando o TSE informa totalização final ou no limite de
05/10/2026 às 12h de Brasília. A página e o histórico continuam disponíveis.
Se a execução for interrompida, use Actions > Arquivar apuração do TSE >
Run workflow. Dados não observados durante uma interrupção não são recriados.

ROBUSTEZ
Validação de eleição/cargo/abrangência/contagens; trava contra concorrência;
ETag e Last-Modified; 304 sem duplicação; correções para baixo aceitas;
geração anterior rejeitada; 403/429 com espera mínima de 10 minutos, 404 com
espera de 5 minutos. Falhas conservam o último resultado e o histórico.
O arquivo público não tem credenciais. O GITHUB_TOKEN fica apenas no runner.

REPRODUZIR E TESTAR
Node 22.13 ou superior, sem dependências npm adicionais:
  node --test scripts/coleta.test.mjs
  node scripts/build.mjs
  node scripts/publicar.mjs
Variáveis opcionais do coletor: ARCHIVE_DIR, COLLECTOR_DB, DURATION_MS.
PUBLISH_GIT=1 habilita os commits na branch dados, usada pelo workflow.
Para prévia local, copie latest.json e history.json para public/data e sirva
public/ por HTTP. Em produção, os dados vêm de raw.githubusercontent.com.

CUSTO E LIMITES
GitHub Pages em repositório público e runners padrão em repositório público
são gratuitos. Nenhum plano pago, runner ampliado, domínio pago ou serviço
externo de banco é necessário. A publicação temporária do conjunto de dados
fica restrita à janela eleitoral. Não há garantia de execução ou latência;
filas, falhas e limites do GitHub podem atrasar a publicação. O histórico
é o que o coletor efetivamente observou, sem reconstrução retroativa.

REFERÊNCIAS
https://docs.github.com/en/pages/getting-started-with-github-pages
https://docs.github.com/en/billing/concepts/product-billing/github-actions
https://docs.github.com/en/actions/reference/limits
https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados
