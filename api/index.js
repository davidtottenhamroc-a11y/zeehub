const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 

const app = express();

// --- Configurações Iniciais ---
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGO_URI; 

// --- Schemas do Sistema de Ponto da Zee Imobiliária ---

const funcionarioSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, unique: true, sparse: true }, 
    senha: { type: String }, 
    cargo: { type: String, required: true },
    isUser: { type: Boolean, default: false }, 
    permissao: { 
        type: String, 
        enum: ['ponto', 'funcionario', 'admin'], 
        default: 'ponto' 
    },
    createdAt: { type: Date, default: Date.now },
}, { collection: 'funcionarios' });

// Pré-save hook para HASHEAR a senha
funcionarioSchema.pre('save', async function(next) {
    if (this.isUser && this.isModified('senha') && this.senha) {
        const salt = await bcrypt.genSalt(10);
        this.senha = await bcrypt.hash(this.senha, salt);
    }
    next();
});

const Funcionario = mongoose.models.Funcionario || mongoose.model('Funcionario', funcionarioSchema);

const pontoSchema = new mongoose.Schema({
    funcionario: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Funcionario', 
        required: true 
    },
    tipo: { 
        type: String, 
        enum: ['checkin', 'pausa', 'retorno', 'checkout'], 
        required: true 
    },
    dataHora: { 
        type: Date, 
        default: Date.now,
        required: true
    },
    observacao: { type: String }
}, { collection: 'pontos' });

const Ponto = mongoose.models.Ponto || mongoose.model('Ponto', pontoSchema);


// --- FUNÇÃO DE CONEXÃO E INICIALIZAÇÃO ---

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

// Rota para verificar se existe um Administrador (Usada pelo Front-end para desbloquear o cadastro)
app.get('/api/admin/check-initial', async (req, res) => {
    try {
        // Conta quantos usuários de login têm permissão 'admin'
        const adminCount = await Funcionario.countDocuments({ isUser: true, permissao: 'admin' });
        // hasAdmin: true se já houver admins, false se for a primeira vez
        res.json({ hasAdmin: adminCount > 0 });
    } catch (error) {
        console.error('Erro ao verificar admins:', error);
        res.status(500).json({ message: 'Erro ao verificar administradores.' });
    }
});


// Rota para autenticação (Login)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        
        const funcionario = await Funcionario.findOne({ email, isUser: true });

        if (!funcionario) {
            return res.status(401).json({ authenticated: false, message: 'Usuário não encontrado ou não tem permissão de acesso.' });
        }
        
        const isMatch = await bcrypt.compare(senha, funcionario.senha);

        if (!isMatch) {
            return res.status(401).json({ authenticated: false, message: 'Email ou senha inválidos.' });
        }

        res.json({ 
            authenticated: true,
            id: funcionario._id, 
            nome: funcionario.nome, 
            permissao: funcionario.permissao 
        });

    } catch (error) {
        console.error('Erro durante a autenticação:', error);
        res.status(500).json({ authenticated: false, message: 'Erro interno do servidor.' });
    }
});


// Rota UNIFICADA de Cadastro (Funcionario Ponto OU Usuário com Acesso)
app.post('/api/cadastro', async (req, res) => {
    const { nome, email, senha, cargo, permissao } = req.body;
    
    const isUser = !!email && !!senha; 
    let finalPermissao = isUser ? (permissao || 'funcionario') : 'ponto'; // Pode ser sobrescrita

    try {
        // LÓGICA DE PROTEÇÃO INICIAL: Força o primeiro usuário a ser ADMIN
        if (isUser) {
            const adminCount = await Funcionario.countDocuments({ isUser: true, permissao: 'admin' });
            if (adminCount === 0) {
                 // Se não houver ADMINS, o PRIMEIRO USUÁRIO CADASTRADO É O ADMIN
                 finalPermissao = 'admin'; 
                 console.log(`Primeiro usuário cadastrado: Forçando permissão para ${finalPermissao}.`);
            }
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
