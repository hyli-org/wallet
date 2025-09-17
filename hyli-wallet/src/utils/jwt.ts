import { NodeApiHttpClient } from "hyli";

import { check_jwt } from "hyli-noir";

/**
 * Registers the Noir contract with the node if it is not already registered.
 * The contract is identified by its name "check_secret".
 * If the contract is not found, it registers the contract using the provided circuit.
 *
 * @param node - The NodeApiHttpClient instance to interact with the NodeApiHttpClient
 * @returns A Promise that resolves when the contract is registered
 */
export const register_check_jwt_contract = async (node: NodeApiHttpClient): Promise<undefined | number[]> => {
    return await node
        .getContract(check_jwt.contract_name)
        .then(() => undefined)
        .catch(async () => {
            const contract = await check_jwt.build_register_contract();
            await node.registerContract(contract);
            return contract.program_id;
        });
};
