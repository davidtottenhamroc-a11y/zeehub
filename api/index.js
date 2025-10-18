const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 

const app = express();

// --- Configurações Iniciais ---
app.use(cors());
app.use(express.json());

// **CORREÇÃO CRÍTICA DE SEGURANÇA E SINTAXE:** // A string de conexão DEVE ser configurada APENAS como variável de ambiente (MONGO_URI) no Vercel.
const MONGODB_URI = process.env.MONGO_URI; 

// --- Credenciais de Acesso ÚNICO (NÃO PERSISTENTE) ---
const INITIAL_EMAIL = 'USER@gmail.com';
const INITIAL_PASSWORD = 'adminotimus32';

// --- Schemas do Sistema de Ponto da Zee Imobiliária ---

const funcionarioSchema = new mongoose.Schema({ /* ... */ }, { collection: 'funcionarios' });
funcionarioSchema.pre('save', async function(next) { /* ... */ });
const Funcionario = mongoose.models.Funcionario || mongoose.model('Funcionario', funcionarioSchema);

const pontoSchema = new mongoose.Schema({ /* ... */ }, { collection: 'pontos' });
const Ponto = mongoose.models.Ponto || mongoose.model('Ponto', pontoSchema);


// --- FUNÇÃO DE CONEXÃO E INICIALIZAÇÃO ---

// Não é mais necessário criar o usuário padrão, apenas conectar.
if (!MONGODB_URI) {
    console.error('ERRO: Variável MONGO_URI não definida.');
} else {
    mongoose.connect(MONGODB_URI)
        .then(() => {
            console.log('Conexão estabelecida com MongoDB Atlas!');
        })
        .catch(err => {
            console.error('Erro FATAL de conexão com o MongoDB:', err.message);
        });
}


// ------------------------------------
// --- Rotas da API Zee Imobiliária ---
// ------------------------------------

// Rota de Teste
app.get('/', (req, res) => {
    res.status(200).send('API de Gestão de Tempo da Zee Imobiliária Rodando.');
});


// Rota para autenticação (Login)
app.post('/api/auth/login', async (req, res) => {
    const { email, senha } = req.body;
    
    // 1. **VERIFICAÇÃO DE ACESSO INICIAL NÃO PERSISTENTE**
    if (email === INITIAL_EMAIL && senha === INITIAL_PASSWORD) {
        // Se a credencial for a de acesso inicial, concede acesso temporário de Admin.
        // O Front-end agora pode acessar as telas de cadastro para criar o Admin REAL.
        return res.json({ 
            authenticated: true,
            id: 'INITIAL_ADMIN_ID', // ID temporário
            nome: 'Acesso Inicial', 
            permissao: 'admin', // Permissão total para cadastro
            message: 'Acesso inicial concedido. Cadastre o Administrador real!'
        });
    }

    // 2. **VERIFICAÇÃO NORMAL NO BANCO DE DADOS**
    try {
        const funcionario = await Funcionario.findOne({ email, isUser: true });

        if (!funcionario) {
            return res.status(401).json({ authenticated: false, message: 'Usuário não encontrado ou não tem permissão de acesso.' });
        }
        
        const isMatch = await bcrypt.compare(senha, funcionario.senha);

        if (!isMatch) {
            return res.status(401).json({ authenticated: false, message: 'Email ou senha inválidos.' });
        }

        // Retorna dados para o Front-end
        res.json({ 
            authenticated: true,
            id: funcionario._id, 
            nome: funcionario.nome, 
            permissao: funcionario.permissao 
        });

    } catch (error) {
        console.error('Erro durante a autenticação no DB:', error);
        res.status(500).json({ authenticated: false, message: 'Erro interno do servidor.' });
    }
});


// Rota UNIFICADA de Cadastro (Funcionário Ponto OU Usuário com Acesso)
app.post('/api/cadastro', async (req, res) => {
    const { nome, email, senha, cargo, permissao } = req.body;
    
    const isUser = !!email && !!senha; 
    const finalPermissao = isUser ? (permissao || 'funcionario') : 'ponto';

    try {
        // Check extra para evitar que a credencial temporária seja cadastrada
        if (isUser && email === INITIAL_EMAIL) {
            return res.status(400).json({ message: 'Este e-mail é reservado para o acesso inicial. Escolha outro para o Admin real.' });
        }

        const novoFuncionario = new Funcionario({
            nome,
            email: isUser ? email : undefined,
            senha: isUser ? senha : undefined,
            cargo,
            isUser,
            permissao: finalPermissao
        });

        await novoFuncionario.save();
        res.status(201).json({ 
            message: `${isUser ? 'Usuário' : 'Funcionário Ponto'} cadastrado com sucesso!`, 
            id: novoFuncionario._id 
        });
    } catch (error) {
        if (error.code === 11000) { 
            return res.status(400).json({ message: 'O email já está em uso.' });
        }
        res.status(400).json({ message: 'Erro ao cadastrar.', details: error.message });
    }
});


// Rota para buscar TODOS os funcionários (para filtro de relatórios)
app.get('/api/funcionarios-ponto', async (req, res) => {
    try {
        const funcionarios = await Funcionario.find({}, '_id nome cargo isUser').sort({ nome: 1 });
        res.send(funcionarios);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar lista de funcionários.' });
    }
});


// Rota para Registro de Ponto
app.post('/api/ponto', async (req, res) => {
    const { funcionario, tipo, observacao } = req.body;
    
    if (!funcionario || !tipo) {
        return res.status(400).json({ message: 'ID do funcionário e tipo de ponto são obrigatórios.' });
    }
    
    try {
        const novoRegistro = new Ponto({ funcionario, tipo, observacao, dataHora: new Date() });
        await novoRegistro.save();
        res.status(201).json({ message: `Ponto (${tipo}) registrado com sucesso.`, registro: novoRegistro });
    } catch (error) {
        res.status(400).json({ message: 'Falha ao registrar o ponto.', details: error.message });
    }
});


// Rota para buscar Relatório de Pontos
app.get('/api/relatorio/:funcionarioId', async (req, res) => {
    const { funcionarioId } = req.params;

    try {
        const query = funcionarioId === 'todos' ? {} : { funcionario: funcionarioId };

        const registros = await Ponto.find(query)
            .populate('funcionario', 'nome cargo') 
            .sort({ dataHora: -1 });

        res.send(registros);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar relatórios de ponto.' });
    }
});


module.exports = app;
