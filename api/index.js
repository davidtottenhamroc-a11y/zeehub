const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 

const app = express();

// --- Configurações Iniciais ---
app.use(cors());
app.use(express.json());

// CORREÇÃO: Confia APENAS na variável de ambiente do Vercel
const MONGODB_URI = process.env.MONGO_URI; 

// --- Schemas ---

const funcionarioSchema = new mongoose.Schema({ /* ... */ }, { collection: 'funcionarios' });
funcionarioSchema.pre('save', async function(next) { /* ... */ });
const Funcionario = mongoose.models.Funcionario || mongoose.model('Funcionario', funcionarioSchema);
const pontoSchema = new mongoose.Schema({ /* ... */ }, { collection: 'pontos' });
const Ponto = mongoose.models.Ponto || mongoose.model('Ponto', pontoSchema);


// --- FUNÇÃO DE INICIALIZAÇÃO DO USUÁRIO PADRÃO (Mantida Iguais) ---

async function createInitialUser() {
    try {
        const adminExists = await Funcionario.findOne({ isUser: true, permissao: 'admin' });

        if (!adminExists) {
            console.log('Nenhum usuário administrador encontrado. Criando usuário padrão...');
            
            const defaultEmail = 'USER@gmail.com'; 
            const defaultPassword = 'adminotimus32';

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(defaultPassword, salt);

            const initialAdmin = new Funcionario({
                nome: 'Administrador Padrão (USER)',
                email: defaultEmail,
                senha: hashedPassword,
                cargo: 'Administrador do Sistema',
                isUser: true,
                permissao: 'admin'
            });

            await initialAdmin.save();
            console.log(`Usuário padrão criado com sucesso. Login: ${defaultEmail}, Senha: ${defaultPassword}`);
        } else {
            console.log('Usuário administrador já existe. Nenhuma ação de inicialização necessária.');
        }
    } catch (error) {
         if (error.code !== 11000) { // Ignora erro de duplicidade de email
            console.error('Erro ao tentar criar usuário inicial:', error.message);
        }
    }
}

// --- CONEXÃO COM O BANCO DE DADOS E CHAMADA DA FUNÇÃO DE INICIALIZAÇÃO ---

// Verifica se a URI está definida antes de conectar
if (!MONGODB_URI) {
    console.error('ERRO DE AMBIENTE: Variável MONGO_URI não definida. O servidor não pode conectar ao banco de dados.');
} else {
    mongoose.connect(MONGODB_URI)
        .then(() => {
            console.log('Conexão estabelecida com MongoDB Atlas!');
            createInitialUser(); // Cria o usuário padrão após a conexão
        })
        .catch(err => {
            console.error('Erro FATAL de conexão com o MongoDB:', err.message);
        });
}


// --- Rotas da API (Mantidas Iguais) ---

app.get('/', (req, res) => {
    res.status(200).send('API de Gestão de Tempo da Zee Imobiliária Rodando.');
});


// Rota para autenticação (Login)
app.post('/api/auth/login', async (req, res) => {
    // ... (lógica de login permanece a mesma)
    const { email, senha } = req.body;
    try {
        const funcionario = await Funcionario.findOne({ email, isUser: true });
        if (!funcionario) return res.status(401).json({ authenticated: false, message: 'Usuário não encontrado ou não tem permissão de acesso.' });
        
        const isMatch = await bcrypt.compare(senha, funcionario.senha);

        if (!isMatch) return res.status(401).json({ authenticated: false, message: 'Email ou senha inválidos.' });

        res.json({ authenticated: true, id: funcionario._id, nome: funcionario.nome, permissao: funcionario.permissao });

    } catch (error) {
        res.status(500).json({ message: 'Erro interno do servidor durante o login.' });
    }
});


// Rota UNIFICADA de Cadastro (Funcionario Ponto OU Usuário com Acesso)
app.post('/api/cadastro', async (req, res) => {
    // ... (lógica de cadastro permanece a mesma)
    const { nome, email, senha, cargo, permissao } = req.body;
    const isUser = !!email && !!senha; 
    const finalPermissao = isUser ? (permissao || 'funcionario') : 'ponto';

    try {
        const novoFuncionario = new Funcionario({ nome, email: isUser ? email : undefined, senha: isUser ? senha : undefined, cargo, isUser, permissao: finalPermissao });
        await novoFuncionario.save();
        res.status(201).json({ message: `${isUser ? 'Usuário' : 'Funcionário Ponto'} cadastrado com sucesso!`, id: novoFuncionario._id });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ message: 'O email já está em uso.' });
        res.status(400).json({ message: 'Erro ao cadastrar.', details: error.message });
    }
});


// Rota para buscar TODOS os funcionários (incluindo apenas ponto) para filtros
app.get('/api/funcionarios-ponto', async (req, res) => {
    // ... (lógica de busca de funcionários permanece a mesma)
    try {
        const funcionarios = await Funcionario.find({}, '_id nome cargo isUser').sort({ nome: 1 });
        res.send(funcionarios);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar lista de funcionários.' });
    }
});


// Rota para Registro de Ponto (sem alterações significativas)
app.post('/api/ponto', async (req, res) => {
    // ... (lógica de registro de ponto permanece a mesma)
    const { funcionario, tipo, observacao } = req.body;
    if (!funcionario || !tipo) return res.status(400).json({ message: 'ID do funcionário e tipo de ponto são obrigatórios.' });
    
    try {
        const novoRegistro = new Ponto({ funcionario, tipo, observacao, dataHora: new Date() });
        await novoRegistro.save();
        res.status(201).json({ message: `Ponto (${tipo}) registrado com sucesso.`, registro: novoRegistro });
    } catch (error) {
        res.status(400).json({ message: 'Falha ao registrar o ponto.', details: error.message });
    }
});


// Rota para buscar Relatório de Pontos (sem alterações significativas)
app.get('/api/relatorio/:funcionarioId', async (req, res) => {
    // ... (lógica de relatório permanece a mesma)
    const { funcionarioId } = req.params;
    try {
        const query = funcionarioId === 'todos' ? {} : { funcionario: funcionarioId };

        const registros = await Ponto.find(query).populate('funcionario', 'nome cargo').sort({ dataHora: -1 });

        res.send(registros);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar relatórios de ponto.' });
    }
});


module.exports = app;
