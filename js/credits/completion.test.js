import { calculateCompletionCredits } from "./completion.js";

//test json data
const testRequirements = {
    completion: {
        firstYear: 33,
        secondYear: 65,
        thirdYear: 98,
        fourthYear: 130
    }
};

//run test
const result = calculateCompletionCredits(
    45,
    testRequirements,
    2
);

console.log("수료까지 남은 학점:", result); //expected == 20
