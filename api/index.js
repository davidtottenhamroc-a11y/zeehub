<script>
    const API_BASE_URL = window.location.origin;
    const form = document.getElementById('form-cadastro-usuario');
    const adminWarning = document.getElementById('admin-warning');
    const permissaoGroup = document.getElementById('permissao-group');
    const backToMenu = document.getElementById('back-to-menu');
    
    // Oculta o back-to-menu inicialmente, a menos que você queira que ele apareça sempre.
    backToMenu.href = 'login.html'; // Garante que volte para o Login
    
    // Função para verificar e configurar o formulário (Primeiro Admin ou Admin Normal)
    async function setupForm() {
        try {
            // 1. Chama a rota de verificação (agora apenas para configurar o formulário)
            const response = await fetch(`${API_BASE_URL}/api/admin/check-initial`);
            
            // Se a API não responder (erro de rede/CORS), a chamada falha antes do status
            if (!response.ok && response.status !== 503) {
                throw new Error('Erro ao verificar o status da API.');
            }
            
            const data = await response.json();
            const hasAdmin = data.hasAdmin;

            if (!hasAdmin) {
                // CASO INICIAL: SEM ADMINS NO BANCO -> FORÇA ADMIN
                adminWarning.classList.remove('hidden');
                permissaoGroup.classList.add('hidden'); // Oculta a seleção
                // Garante que o valor enviado será 'admin', mesmo que o campo esteja oculto
                document.getElementById('permissao').value = 'admin'; 
                
            } else {
                // CASO NORMAL: JÁ TEM ADMINS
                adminWarning.classList.add('hidden');
                permissaoGroup.classList.remove('hidden');
                
                // *** IMPORTANTE: Se o usuário não estiver logado como admin, 
                // ele só poderá ver esta tela se o seu servidor não exigir login
                // para acessar o arquivo HTML. A restrição real será no POST.
            }

        } catch (error) {
            // Se houver falha na comunicação, assume-se que é o primeiro admin para permitir
            // o cadastro inicial caso a API esteja fora/caindo.
            console.warn('Falha na verificação do status inicial. Assumindo modo de cadastro do PRIMEIRO ADMIN para evitar bloqueio.', error);
            adminWarning.classList.remove('hidden');
            permissaoGroup.classList.add('hidden');
            document.getElementById('permissao').value = 'admin';
        }
    }
    
    // Inicia a configuração do formulário assim que a página carrega
    setupForm();


    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const msg = document.getElementById('msg-feedback');
        const submitBtn = document.querySelector('.btn-submit');
        
        msg.className = 'loading';
        msg.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aguarde, cadastrando usuário...';
        msg.style.display = 'block';
        submitBtn.disabled = true;

        const dados = {
            nome: document.getElementById('nome').value,
            email: document.getElementById('email').value,
            senha: document.getElementById('senha').value,
            cargo: document.getElementById('cargo').value,
            // Pega o valor, que pode ter sido setado para 'admin' na configuração
            permissao: document.getElementById('permissao').value 
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/cadastro`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dados)
            });

            const data = await response.json();

            if (response.ok) {
                msg.className = 'success';
                msg.innerHTML = `<i class="fas fa-check-circle"></i> ${data.message} Agora você pode fazer login.`;
                form.reset(); 
                
                // Redireciona para o login após 3s
                setTimeout(() => { window.location.href = 'login.html'; }, 3000);
                
            } else {
                msg.className = 'error';
                msg.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Erro: ${data.message || 'Falha ao cadastrar usuário.'}`;
            }

        } catch (error) {
            msg.className = 'error';
            msg.innerHTML = '<i class="fas fa-times-circle"></i> Erro de rede. Verifique a conexão com a API.';
        } finally {
            submitBtn.disabled = false;
            // Refaz a checagem após o cadastro para redefinir o estado de "primeiro admin"
            setupForm(); 
        }
    });
</script>
