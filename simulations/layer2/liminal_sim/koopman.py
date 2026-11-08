"""Koopman / Dynamic Mode Decomposition (DMD) models of the flock's collective state.

Architecture section 16: track functions of the swarm state ("observables")
instead of the state itself; a linear operator K then advances them in time,
K g(x_k) ~ g(x_k+1), and K can be learned from data (DMD). Prediction becomes a
matrix multiplication, and with an input (DMD with control, Proctor et al. 2016)
g_k+1 ~ A g_k + B v_k, the swarm becomes a linear system to control.

Observables here are the 51 coarse-grained numbers of reservoir.py (4 x 4 grid of
mean heading and density, plus flock order and mean heading), z-scored with the
training mean and spread. The fitted model is truncated to rank r (projected on
the leading r singular vectors of the training data, as in exact DMD), with r
chosen by validation. Because the observables are centred with the training
mean, the model includes a constant term: z_k+1 = A z_k + B v_k + c.
"""
import numpy as np


class DMD:
    def __init__(self, rank, n_in=0, ridge=1e-6):
        self.rank, self.n_in, self.ridge = rank, n_in, ridge

    def fit(self, runs, inputs=None):
        """runs: list of arrays (T_i, d) of observables, consecutive samples.
        inputs: list of arrays (T_i, n_in) of the input applied during step t -> t+1."""
        Xall = np.vstack(runs)
        self.mu = Xall.mean(axis=0)
        self.sd = Xall.std(axis=0)
        self.sd[self.sd == 0] = 1.0
        Z = [(g - self.mu) / self.sd for g in runs]
        X = np.vstack([z[:-1] for z in Z])
        Y = np.vstack([z[1:] for z in Z])
        U, s, Vt = np.linalg.svd(np.vstack(Z), full_matrices=False)
        self.P = Vt[: self.rank].T                     # d x r projection
        Xr, Yr = X @ self.P, Y @ self.P
        if self.n_in:
            V = np.vstack([v[:-1] for v in inputs])
            Xr = np.hstack([Xr, V])
        Xr = np.hstack([Xr, np.ones((Xr.shape[0], 1))])
        G = Xr.T @ Xr + self.ridge * np.eye(Xr.shape[1])
        M = np.linalg.solve(G, Xr.T @ Yr).T            # r x (r + n_in + 1)
        self.A = M[:, : self.rank]
        self.B = M[:, self.rank: self.rank + self.n_in] if self.n_in else None
        self.c = M[:, -1]
        return self

    def predict(self, g0, h, future_inputs=None):
        """Predict observables h steps ahead from g0 (shape (m, d)), m starts at once.
        future_inputs: array (m, h, n_in) of the inputs over the next h steps."""
        z = ((g0 - self.mu) / self.sd) @ self.P
        for k in range(h):
            z = z @ self.A.T + self.c
            if self.n_in:
                z = z + future_inputs[:, k, :] @ self.B.T
        return (z @ self.P.T) * self.sd + self.mu

    def eigenvalues(self):
        return np.linalg.eigvals(self.A)


def ar1_fit(series_list):
    """Scalar AR(1) around the mean: s_t+1 - m = a (s_t - m)."""
    s = np.concatenate(series_list)
    m = s.mean()
    x = np.concatenate([q[:-1] for q in series_list]) - m
    y = np.concatenate([q[1:] for q in series_list]) - m
    a = float(np.dot(x, y) / np.dot(x, x))
    return m, a


def angle_error(c_true, s_true, c_pred, s_pred):
    """Absolute angle between true and predicted heading, degrees."""
    d = np.arctan2(s_true, c_true) - np.arctan2(s_pred, c_pred)
    return np.degrees(np.abs((d + np.pi) % (2 * np.pi) - np.pi))
