const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 

const app = express();

// --- Configurações Iniciais ---
app.use(cors());
app.use(express.json({ limit: '5mb' })); // CRÍTICO: Aumenta o limite para aceitar o Base64 do arquivo
// Para arquivos de 1MB, 5MB de limite é seguro.

// A string de conexão DEVE ser configurada APENAS como variável de ambiente (MONGO_URI) no Vercel.
const MONGODB_URI = process.env.MONGO_URI || "mongodb+srv://davidtottenhamroc_db_user:david0724@cluster0.q29vt6z.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"; 

// --- Schemas do Sistema de Ponto da Zee Imobiliária ---

const funcionarioSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, unique: true, sparse: true }, 
    senha: { type: String }, 
    cargo: { type: String, required: true },
    isUser: { type: Boolean, default: false }, 
    permissao: { 
        type: String, 
        enum: ['ponto', 'funcionario', 'gestor', 'admin'], 
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


// --- NOVO SCHEMA: Contrato Imobiliário (com campo Base64) ---
const contratoSchema = new mongoose.Schema({
    tipo: { type: String, enum: ['Venda', 'Aluguel'], required: true },
    imovelEndereco: { type: String, required: true },
    valorContrato: { type: Number, required: true },
    corretor: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Funcionario', 
        required: true 
    },
    dataFechamento: { type: Date, default: Date.now },
    observacoes: { type: String },
    
    // CAMPOS PARA ARQUIVO BASE64
    arquivo: { type: String }, // String grande para o Base64
    nomeArquivo: { type: String } // Nome original do arquivo
}, { collection: 'contratos' });

const Contrato = mongoose.models.Contrato || mongoose.model('Contrato', contratoSchema);


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

// Rota de Teste
app.get('/', (req, res) => {
    res.status(200).send('API de Gestão de Tempo da Zee Imobiliária Rodando.');
});


// Rota para verificar se existe um Administrador
app.get('/api/admin/check-initial', async (req, res) => {
    try {
        const adminCount = await Funcionario.countDocuments({ isUser: true, permissao: 'admin' });
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


// Rota UNIFICADA de Cadastro (Funcionário Ponto OU Usuário com Acesso)
app.post('/api/cadastro', async (req, res) => {
    const { nome, email, senha, cargo, permissao } = req.body;
    
    const isUserRequest = !!email && !!senha; 
    let finalPermissao = isUserRequest ? (permissao || 'funcionario') : 'ponto'; 

    try {
        let funcionarioExistente = null;
        
        if (email) {
            funcionarioExistente = await Funcionario.findOne({ email });
        }

        if (isUserRequest) {
            
            if (funcionarioExistente) {
                if (funcionarioExistente.isUser) {
                     return res.status(400).json({ message: 'O e-mail já está em uso por outro usuário com acesso. Não é possível vincular.' });
                }
                
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(senha, salt);
                
                const adminCount = await Funcionario.countDocuments({ isUser: true, permissao: 'admin' });
                if (adminCount === 0) {
                     finalPermissao = 'admin'; 
                }

                const atualizado = await Funcionario.findByIdAndUpdate(funcionarioExistente._id, {
                    senha: hashedPassword,
                    isUser: true,
                    permissao: finalPermissao,
                    nome: nome, 
                    cargo: cargo
                }, { new: true });

                return res.status(200).json({ 
                    message: `Usuário '${email}' vinculado e atualizado com acesso '${finalPermissao}'!`, 
                    id: atualizado._id 
                });

            } else {
                
                const adminCount = await Funcionario.countDocuments({ isUser: true, permissao: 'admin' });
                if (adminCount === 0) {
                     finalPermissao = 'admin'; 
                }
                
                const novoUsuario = new Funcionario({
                    nome,
                    email,
                    senha, 
                    cargo,
                    isUser: true,
                    permissao: finalPermissao
                });
                
                await novoUsuario.save();
                return res.status(201).json({ 
                    message: `Novo Usuário '${email}' cadastrado com sucesso!`, 
                    id: novoUsuario._id 
                });
            }

        } else {
            // --- Se o registro for para um FUNCIONÁRIO SÓ PONTO (Sem Login) ---
            
            if (funcionarioExistente) {
                return res.status(400).json({ message: 'O e-mail já está em uso por um colaborador. Não é possível cadastrar duas vezes.' });
            }

            const novoPonto = new Funcionario({
                nome,
                email: email || undefined, 
                cargo,
                isUser: false,
                permissao: 'ponto'
            });

            await novoPonto.save();
            return res.status(201).json({ 
                message: `Funcionário '${nome}' cadastrado apenas para ponto.`, 
                id: novoPonto._id 
            });
        }

    } catch (error) {
        console.error('Erro geral no cadastro:', error);
        res.status(500).json({ message: 'Erro interno do servidor durante o cadastro.', details: error.message });
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


// --- ROTAS DE CONTRATO (Aceitando Base64) ---

// Rota para Cadastrar Novo Contrato
app.post('/api/contratos', async (req, res) => {
    // Note: A validação de permissão deve ser feita no Front-end (apenas Admin acessa)
    try {
        const novoContrato = new Contrato(req.body); // Os campos arquivo e nomeArquivo são incluídos aqui
        await novoContrato.save();
        res.status(201).json({ message: 'Contrato cadastrado com sucesso!', contrato: novoContrato });
    } catch (error) {
        console.error('Erro ao cadastrar contrato:', error);
        res.status(400).json({ message: 'Falha ao cadastrar contrato.', details: error.message });
    }
});

// Rota para buscar Contratos para o Relatório (Filtro por Corretor)
app.get('/api/contratos/relatorio/:corretorId', async (req, res) => {
    const { corretorId } = req.params;

    try {
        const query = corretorId === 'todos' ? {} : { corretor: corretorId };

        // Popula o corretor com apenas nome e cargo para a tabela
        const contratos = await Contrato.find(query)
            .populate('corretor', 'nome cargo') 
            .sort({ dataFechamento: -1 }); // Ordena do mais recente para o mais antigo

        res.send(contratos);
    } catch (error) {
        console.error('Erro ao buscar contratos:', error);
        res.status(500).json({ message: 'Erro ao buscar contratos.' });
    }
});

// Rota para buscar Dados de Dashboard (Contratos Fechados Mensalmente)
app.get('/api/contratos/dashboard', async (req, res) => {
    try {
        const dashboardData = await Contrato.aggregate([
            {
                $group: {
                    _id: {
                        year: { $year: "$dataFechamento" },
                        month: { $month: "$dataFechamento" }
                    },
                    totalContratos: { $sum: 1 },
                    totalValor: { $sum: "$valorContrato" }
                }
            },
            {
                $sort: { "_id.year": 1, "_id.month": 1 }
            }
        ]);

        res.send(dashboardData);
    } catch (error) {
        console.error('Erro ao gerar dados do dashboard:', error);
        res.status(500).json({ message: 'Erro ao gerar dados do dashboard.' });
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
