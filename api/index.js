const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 

const app = express();

// --- Configurações Iniciais ---
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGO_URI; 

mongoose.connect(MONGODB_URI)
    .then(() => console.log('Conexão estabelecida com MongoDB Atlas!'))
    .catch(err => {
        console.error('Erro FATAL de conexão com o MongoDB:', err);
    });

// --- Schemas ---

const funcionarioSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    // Email e Senha não são obrigatórios para funcionários que SÓ batem ponto
    email: { type: String, unique: true, sparse: true }, // sparse: permite múltiplos nulos, mas mantém a unicidade
    senha: { type: String }, // Não é obrigatório para funcionários sem acesso de login
    cargo: { type: String, required: true },
    // Define se o registro é APENAS para ponto, ou se é um usuário com login
    isUser: { type: Boolean, default: false }, 
    permissao: { 
        type: String, 
        enum: ['ponto', 'funcionario', 'admin'], 
        default: 'ponto' // Ponto é o novo default para funcionários sem acesso de login
    },
    createdAt: { type: Date, default: Date.now },
}, { collection: 'funcionarios' });

// Pré-save hook para HASHEAR a senha (só se 'isUser' for true e 'senha' existir)
funcionarioSchema.pre('save', async function(next) {
    // Só criptografa se for um usuário E se a senha tiver sido modificada ou for nova
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


// --- Rotas da API ---

app.get('/', (req, res) => {
    res.status(200).send('API de Gestão de Tempo da Zee Imobiliária Rodando.');
});


// Rota para autenticação (Login)
app.post('/api/auth/login', async (req, res) => {
    const { email, senha } = req.body;

    try {
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
        res.status(500).json({ message: 'Erro interno do servidor durante o login.' });
    }
});


// Rota UNIFICADA de Cadastro (Funcionario Ponto OU Usuário com Acesso)
app.post('/api/cadastro', async (req, res) => {
    const { nome, email, senha, cargo, permissao } = req.body;
    
    // Define se o registro é um usuário que fará login
    const isUser = !!email && !!senha; 
    
    // Define a permissão correta
    const finalPermissao = isUser ? (permissao || 'funcionario') : 'ponto';

    try {
        const novoFuncionario = new Funcionario({
            nome,
            email: isUser ? email : undefined, // Só salva se for usuário
            senha: isUser ? senha : undefined, // O pré-save hook fará o hash
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


// Rota para buscar TODOS os funcionários (incluindo apenas ponto) para filtros
app.get('/api/funcionarios-ponto', async (req, res) => {
    try {
        const funcionarios = await Funcionario.find({}, '_id nome cargo isUser').sort({ nome: 1 });
        res.send(funcionarios);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar lista de funcionários.' });
    }
});


// Rota para Registro de Ponto (sem alterações significativas)
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


// Rota para buscar Relatório de Pontos (sem alterações significativas)
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